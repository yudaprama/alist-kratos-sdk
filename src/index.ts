/**
 * AList × Kratos JS SDK
 *
 * Usage:
 *   import { AlistClient } from "alist-kratos-sdk";
 *
 *   // Auto-login with Kratos session cookie or token
 *   const client = await AlistClient.fromKratosSession(
 *     "http://localhost:4433",  // Kratos public URL
 *     "http://localhost:5244"  // AList URL
 *   );
 *
 *   // Or explicit session
 *   const client = new AlistClient({
 *     alistUrl: "http://localhost:5244",
 *     kratosSessionToken: "...",
 *   });
 *
 *   // Use it
 *   const files = await client.list("/");
 *   await client.upload("/photo.jpg", file);
 *   const blob = await client.download("/photo.jpg");
 */

export interface AlistConfig {
  /** AList base URL, e.g. http://localhost:5244 */
  alistUrl: string;
  /** Ory Kratos session token (from cookie or X-Session-Token) */
  kratosSessionToken: string;
  /** Optional: override Kratos public URL for session validation */
  kratosUrl?: string;
  /** Optional: pre-built Authorization header (skips "kratos:" prefix) */
  rawAuthHeader?: string;
}

export interface AlistFile {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  created?: string;
  sign?: string;
  thumb?: string;
  type: number;
  hashinfo?: string | null;
  hash_info?: unknown;
}

export interface AlistListResponse {
  content: AlistFile[];
  total: number;
  filtered_total: number;
  page: number;
  per_page: number;
  has_more: boolean;
  pages_total: number;
  readme: string;
  header: string;
  write: boolean;
  provider: string;
}

export interface AlistUser {
  id: number;
  username: string;
  sso_id?: string;
  base_path: string;
  role: number;
  permission: number;
  disabled: boolean;
  otp?: boolean;
  role_names: string[];
  permissions: Array<{ path: string; permission: number }>;
}

export class AlistApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(`[${status}] ${code}: ${message}`);
    this.name = "AlistApiError";
  }
}

export class AlistClient {
  private readonly alistUrl: string;
  private readonly authHeader: string;

  constructor(config: AlistConfig | string) {
    if (typeof config === "string") {
      // Bare session token shortcut
      const alistUrl = arguments[1] ?? "http://localhost:5244";
      this.alistUrl = alistUrl.replace(/\/+$/, "");
      this.authHeader = `kratos:${config}`;
    } else {
      this.alistUrl = config.alistUrl.replace(/\/+$/, "");
      this.authHeader =
        config.rawAuthHeader ?? `kratos:${config.kratosSessionToken}`;
    }
  }

  /**
   * Auto-create a client by validating a session via Kratos.
   * Returns null if the session is invalid.
   *
   * @param kratosUrl - Kratos public URL, e.g. http://localhost:4433
   * @param alistUrl - AList base URL, defaults to http://localhost:5244
   * @param sessionToken - Optional token. If omitted, reads `ory_kratos_session` cookie.
   */
  static async fromKratosSession(
    kratosUrl: string,
    alistUrl = "http://localhost:5244",
    sessionToken?: string,
  ): Promise<AlistClient | null> {
    const token =
      sessionToken ?? (typeof document !== "undefined" ? readCookie("ory_kratos_session") : undefined);
    if (!token) return null;

    // Validate the session with Kratos /sessions/whoami
    const valid = await validateKratosSession(kratosUrl, token);
    if (!valid) return null;

    return new AlistClient({
      alistUrl,
      kratosSessionToken: token,
    });
  }

  // ─── Low-level request helper ────────────────────────────────────────────

  private async request<T = unknown>(
    method: string,
    path: string,
    init?: { body?: BodyInit | null; headers?: Record<string, string> },
  ): Promise<T> {
    const url = `${this.alistUrl}${path.startsWith("/") ? path : "/" + path}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: this.authHeader,
        ...(init?.body && !(init.body instanceof FormData)
          ? { "Content-Type": "application/json" }
          : {}),
        ...init?.headers,
      },
      body: init?.body ?? null,
      redirect: "manual",
    });

    if (res.status === 302) {
      // AList's /d/* and /p/* endpoints redirect to pre-signed URLs.
      // Follow manually so the caller gets the final blob.
      const location = res.headers.get("Location");
      if (!location) throw new AlistApiError(res.status, 0, "redirect with no Location");
      const followed = await fetch(location, { redirect: "follow" });
      if (!followed.ok) {
        throw new AlistApiError(followed.status, followed.status, "redirect target failed");
      }
      return (await followed.blob()) as unknown as T;
    }

    const text = await res.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    if (!res.ok) {
      const code = body?.code ?? res.status;
      const message = body?.message ?? res.statusText;
      throw new AlistApiError(res.status, code, message, body);
    }
    return body as T;
  }

  // ─── Auth / user ──────────────────────────────────────────────────────────

  /** Get the currently authenticated AList user (auto-provisioned from Kratos identity). */
  me(): Promise<{ code: number; data: AlistUser }> {
    return this.request("GET", "/api/me");
  }

  // ─── File operations ────────────────────────────────────────────────────

  /**
   * List files in a directory.
   * @param path - Directory path, defaults to `/` (the user's BasePath root)
   * @param opts - Pagination options
   */
  list(
    path = "/",
    opts: { page?: number; per_page?: number; refresh?: boolean; password?: string } = {},
  ): Promise<{ code: number; data: AlistListResponse }> {
    return this.request("POST", "/api/fs/list", {
      body: JSON.stringify({ path, ...opts }),
    });
  }

  /**
   * Get info about a single file/dir.
   */
  get(path: string, password?: string): Promise<{ code: number; data: AlistFile }> {
    return this.request("POST", "/api/fs/get", {
      body: JSON.stringify({ path, password }),
    });
  }

  /**
   * Create a directory.
   */
  mkdir(path: string): Promise<{ code: number }> {
    return this.request("POST", "/api/fs/mkdir", {
      body: JSON.stringify({ path }),
    });
  }

  /**
   * Rename a file or directory.
   */
  rename(name: string, path: string): Promise<{ code: number }> {
    return this.request("POST", "/api/fs/rename", {
      body: JSON.stringify({ name, path }),
    });
  }

  /**
   * Upload a file. Path is the FULL destination (including filename).
   * Returns immediately on success.
   *
   * @param path - Full destination path, e.g. "/photos/sunset.jpg"
   * @param file - Blob | File | ArrayBuffer
   * @param opts - Upload options
   */
  async upload(
    path: string,
    file: Blob | File | ArrayBuffer,
    opts: { asTask?: boolean; contentType?: string } = {},
  ): Promise<{ code: number; data?: { task?: unknown } }> {
    const form = new FormData();
    if (file instanceof ArrayBuffer) {
      form.append("file", new Blob([file], { type: opts.contentType ?? "application/octet-stream" }));
    } else {
      form.append("file", file, opts.contentType);
    }
    return this.request("PUT", "/api/fs/form", {
      body: form,
      headers: {
        "File-Path": encodeURIComponent(path),
        ...(opts.asTask ? { "As-Task": "true" } : {}),
      },
    });
  }

  /**
   * Stream a file from the user's storage. Returns a Blob.
   * For large files, consider using `downloadUrl()` to get a pre-signed URL
   * and fetch with progress.
   */
  async download(path: string, password?: string): Promise<Blob> {
    const url = new URL(`${this.alistUrl}/d${path.startsWith("/") ? "" : "/"}${path}`);
    url.searchParams.set("sign", "");
    if (password) url.searchParams.set("p", password);
    const res = await fetch(url.toString(), {
      headers: { Authorization: this.authHeader },
      redirect: "follow",
    });
    if (!res.ok) {
      throw new AlistApiError(res.status, res.status, `download failed for ${path}`);
    }
    return res.blob();
  }

  /**
   * Get a pre-signed URL for a file. Pass this URL directly to <img src="..."> /
   * <a href="..."> / window.open() — no Authorization header needed.
   * URL expires per AList's `sign` expiration setting (default no expiry).
   */
  async downloadUrl(path: string, password?: string): Promise<string> {
    // AList's /d/<path>?sign=... returns 302 to a pre-signed URL.
    // We grab the Location header without following.
    const url = new URL(`${this.alistUrl}/d${path.startsWith("/") ? "" : "/"}${path}`);
    url.searchParams.set("sign", "");
    if (password) url.searchParams.set("p", password);
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Authorization: this.authHeader },
      redirect: "manual",
    });
    if (res.status !== 302) {
      throw new AlistApiError(res.status, res.status, `expected 302 for ${path}, got ${res.status}`);
    }
    const location = res.headers.get("Location");
    if (!location) throw new AlistApiError(res.status, 0, "no Location header");
    return location;
  }

  /**
   * Delete one or more files/dirs.
   */
  remove(paths: string[], password?: string): Promise<{ code: number }> {
    return this.request("POST", "/api/fs/remove", {
      body: JSON.stringify({ names: paths, password }),
    });
  }

  /**
   * Move files to another directory.
   */
  move(srcDirs: string[], dstDir: string, password?: string): Promise<{ code: number }> {
    return this.request("POST", "/api/fs/move", {
      body: JSON.stringify({ src_dir: srcDirs, dst_dir: dstDir, password }),
    });
  }

  /**
   * Copy files to another directory.
   */
  copy(srcDirs: string[], dstDir: string, password?: string): Promise<{ code: number }> {
    return this.request("POST", "/api/fs/copy", {
      body: JSON.stringify({ src_dir: srcDirs, dst_dir: dstDir, password }),
    });
  }

  /**
   * Recursive search.
   */
  search(
    parent: string,
    keywords: string,
    opts: { scope?: number; page?: number; per_page?: number } = {},
  ): Promise<{ code: number; data: { content: AlistFile[]; total: number } }> {
    return this.request("POST", "/api/fs/search", {
      body: JSON.stringify({ parent, keywords, ...opts }),
    });
  }

  // ─── Health check ───────────────────────────────────────────────────────

  ping(): Promise<boolean> {
    return this.request("GET", "/ping")
      .then(() => true)
      .catch(() => false);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function readCookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : undefined;
}

async function validateKratosSession(
  kratosUrl: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${kratosUrl.replace(/\/+$/, "")}/sessions/whoami`, {
      headers: { "X-Session-Token": token, Accept: "application/json" },
    });
    if (!res.ok) return false;
    const session = (await res.json()) as { active?: boolean };
    return session.active === true;
  } catch {
    return false;
  }
}
