/**
 * AList × Kratos JS SDK
 *
 * Usage:
 *   import { AlistClient } from "alist-kratos-sdk";
 *
 *   // Auto-login with Kratos session cookie or token.
 *   // Automatically discovers the user's basePath from /api/me
 *   // so all operations are scoped to the authenticated user's folder.
 *   const client = await AlistClient.fromKratosSession(
 *     "http://localhost:4455"  // Oathkeeper edge URL
 *   );
 *
 *   // Paths are relative to the user's base folder.
 *   const files = await client.list("/");          // lists own root
 *   await client.upload("/photos/sunset.jpg", file); // auto-resolved
 *   const blob = await client.download("/photos/sunset.jpg");
 */

export interface AlistConfig {
  /** AList base URL, e.g. http://localhost:5244 */
  alistUrl: string;
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
  /**
   * User's BasePath (e.g. "/<identity_id>") discovered lazily via /api/me.
   * `null` until the first call to a method that needs it.
   */
  private basePath: string | null = null;
  private basePathPromise: Promise<string> | null = null;

  constructor(config: AlistConfig | string) {
    if (typeof config === "string") {
      this.alistUrl = config.replace(/\/+$/, "");
    } else {
      this.alistUrl = config.alistUrl.replace(/\/+$/, "");
    }
  }

  /**
   * Auto-create a client for the Oathkeeper-protected AList edge.
   * Browser credentials are included on each request so Oathkeeper can validate
   * the Kratos session cookie and inject identity headers upstream.
   *
   * @param alistUrl - AList edge URL, defaults to http://localhost:4455
   */
  static async fromKratosSession(
    alistUrl = "http://localhost:4455",
  ): Promise<AlistClient | null> {
    return new AlistClient({ alistUrl });
  }

  // ─── Path helpers ────────────────────────────────────────────────────────

  /**
   * Resolves a path supplied by the caller to one AList will accept.
   *
   * AList's /api/fs/* endpoints are scoped to the user's BasePath. With
   * the upstream BasePath-containment fix, absolute paths outside the
   * BasePath are rejected with 403; truly relative paths (no leading
   * slash) are auto-resolved under BasePath server-side.
   *
   * To keep the SDK API ergonomic (callers never repeat their own
   * identity id), we forward paths exactly as supplied and let AList
   * do the joining. Callers should pass paths that are either:
   *   - relative (no leading slash), or
   *   - absolute and inside their own BasePath.
   *
   * This method only normalizes the "/" sentinel into the user's
   * BasePath so that `list("/")` and similar calls always target the
   * user's root regardless of how AList resolves it.
   */
  private async resolvePath(p: string): Promise<string> {
    if (p === "/" || p === "") {
      const basePath = await this.ensureBasePath();
      return basePath;
    }
    return p;
  }

  /** Lazily discover the user's BasePath from /api/me (cached). */
  private ensureBasePath(): Promise<string> {
    if (this.basePath !== null) return Promise.resolve(this.basePath);
    if (this.basePathPromise) return this.basePathPromise;
    this.basePathPromise = (async () => {
      const me = await this.me();
      const bp = me?.data?.base_path;
      if (!bp) {
        throw new AlistApiError(
          0,
          0,
          "could not discover BasePath from /api/me — call me() first or check auth",
        );
      }
      this.basePath = bp;
      return bp;
    })();
    return this.basePathPromise;
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
      credentials: "include",
      headers: {
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

  /**
   * Get the currently authenticated AList user (auto-provisioned from Kratos
   * identity). The response includes `base_path`, which the SDK caches and
   * uses to resolve the `/` sentinel in other methods.
   */
  async me(): Promise<{ code: number; data: AlistUser }> {
    const res = await this.request<{ code: number; data: AlistUser }>("GET", "/api/me");
    if (res?.data?.base_path) this.basePath = res.data.base_path;
    return res;
  }

  // ─── File operations ────────────────────────────────────────────────────

  /**
   * List files in a directory.
   * @param path - Directory path, defaults to `/` (the user's BasePath root).
   *               Paths without a leading slash are resolved under BasePath
   *               server-side; `/` returns the BasePath root itself.
   * @param opts - Pagination options
   */
  async list(
    path = "/",
    opts: { page?: number; per_page?: number; refresh?: boolean; password?: string } = {},
  ): Promise<{ code: number; data: AlistListResponse }> {
    const resolved = await this.resolvePath(path);
    return this.request("POST", "/api/fs/list", {
      body: JSON.stringify({ path: resolved, ...opts }),
    });
  }

  /**
   * Get info about a single file/dir.
   * @param path - Path inside the user's BasePath.
   */
  async get(path: string, password?: string): Promise<{ code: number; data: AlistFile }> {
    const resolved = await this.resolvePath(path);
    return this.request("POST", "/api/fs/get", {
      body: JSON.stringify({ path: resolved, password }),
    });
  }

  /**
   * Create a directory under the user's BasePath.
   */
  async mkdir(path: string): Promise<{ code: number }> {
    const resolved = await this.resolvePath(path);
    return this.request("POST", "/api/fs/mkdir", {
      body: JSON.stringify({ path: resolved }),
    });
  }

  /**
   * Rename a file or directory under the user's BasePath.
   */
  async rename(name: string, path: string): Promise<{ code: number }> {
    const resolved = await this.resolvePath(path);
    return this.request("POST", "/api/fs/rename", {
      body: JSON.stringify({ name, path: resolved }),
    });
  }

  /**
   * Upload a file. The destination path is resolved under the user's BasePath.
   *
   * @param path - Destination path inside the user's folder, e.g. "/photos/sunset.jpg".
   *               Paths without a leading slash are auto-prefixed server-side.
   * @param file - Blob | File | ArrayBuffer
   * @param opts - Upload options
   */
  async upload(
    path: string,
    file: Blob | File | ArrayBuffer,
    opts: { asTask?: boolean; contentType?: string } = {},
  ): Promise<{ code: number; data?: { task?: unknown } }> {
    const resolved = await this.resolvePath(path);
    const form = new FormData();
    if (file instanceof ArrayBuffer) {
      form.append("file", new Blob([file], { type: opts.contentType ?? "application/octet-stream" }));
    } else {
      form.append("file", file, opts.contentType);
    }
    return this.request("PUT", "/api/fs/form", {
      body: form,
      headers: {
        "File-Path": encodeURIComponent(resolved),
        ...(opts.asTask ? { "As-Task": "true" } : {}),
      },
    });
  }

  /**
   * Stream a file from the user's folder. Returns a Blob.
   * For large files, consider using `downloadUrl()` to get a pre-signed URL
   * and fetch with progress.
   */
  async download(path: string, password?: string): Promise<Blob> {
    const resolved = await this.resolvePath(path);
    const url = new URL(`${this.alistUrl}/d${resolved.startsWith("/") ? "" : "/"}${resolved}`);
    url.searchParams.set("sign", "");
    if (password) url.searchParams.set("p", password);
    const res = await fetch(url.toString(), {
      credentials: "include",
      redirect: "follow",
    });
    if (!res.ok) {
      throw new AlistApiError(res.status, res.status, `download failed for ${path}`);
    }
    return res.blob();
  }

  /**
   * Get a pre-signed URL for a file in the user's folder. Pass this URL
   * directly to <img src="..."> / <a href="..."> / window.open() — no
   * Authorization header needed. URL expires per AList's `sign` setting
   * (default no expiry).
   */
  async downloadUrl(path: string, password?: string): Promise<string> {
    const resolved = await this.resolvePath(path);
    // AList's /d/<path>?sign=... returns 302 to a pre-signed URL.
    // We grab the Location header without following.
    const url = new URL(`${this.alistUrl}/d${resolved.startsWith("/") ? "" : "/"}${resolved}`);
    url.searchParams.set("sign", "");
    if (password) url.searchParams.set("p", password);
    const res = await fetch(url.toString(), {
      method: "GET",
      credentials: "include",
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
   * Delete one or more files/dirs under the user's BasePath.
   */
  async remove(paths: string[], password?: string): Promise<{ code: number }> {
    const resolved = await Promise.all(paths.map((p) => this.resolvePath(p)));
    return this.request("POST", "/api/fs/remove", {
      body: JSON.stringify({ names: resolved, password }),
    });
  }

  /**
   * Move files to another directory under the user's BasePath.
   */
  async move(srcDirs: string[], dstDir: string, password?: string): Promise<{ code: number }> {
    const srcs = await Promise.all(srcDirs.map((p) => this.resolvePath(p)));
    const dst = await this.resolvePath(dstDir);
    return this.request("POST", "/api/fs/move", {
      body: JSON.stringify({ src_dir: srcs, dst_dir: dst, password }),
    });
  }

  /**
   * Copy files to another directory under the user's BasePath.
   */
  async copy(srcDirs: string[], dstDir: string, password?: string): Promise<{ code: number }> {
    const srcs = await Promise.all(srcDirs.map((p) => this.resolvePath(p)));
    const dst = await this.resolvePath(dstDir);
    return this.request("POST", "/api/fs/copy", {
      body: JSON.stringify({ src_dir: srcs, dst_dir: dst, password }),
    });
  }

  /**
   * Recursive search under a parent path within the user's BasePath.
   */
  async search(
    parent: string,
    keywords: string,
    opts: { scope?: number; page?: number; per_page?: number } = {},
  ): Promise<{ code: number; data: { content: AlistFile[]; total: number } }> {
    const resolvedParent = await this.resolvePath(parent);
    return this.request("POST", "/api/fs/search", {
      body: JSON.stringify({ parent: resolvedParent, keywords, ...opts }),
    });
  }

  // ─── Health check ───────────────────────────────────────────────────────

  ping(): Promise<boolean> {
    return this.request("GET", "/ping")
      .then(() => true)
      .catch(() => false);
  }
}
