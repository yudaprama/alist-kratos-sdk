# alist-kratos-sdk

JavaScript / TypeScript SDK for the AList file API behind the Ory Oathkeeper edge. The edge validates the Kratos session cookie and injects the user's identity; the SDK sends cookie-authenticated requests and exposes typed file operations scoped to the user's own folder.

## Install

```bash
npm install alist-kratos-sdk
```

## Quick start

```ts
import { AlistClient } from "alist-kratos-sdk";

// Browser: the ory_kratos_session cookie is sent automatically (credentials:"include").
// The URL MUST include the /.assets/alist mount prefix — AList's edge rules only
// match under it, and paths like /api/me are appended verbatim.
const client = await AlistClient.fromKratosSession(
  "http://localhost:4455/.assets/alist", // edge + mount prefix (also the default)
);

if (!client) throw new Error("No valid Kratos session – user must log in");

// All paths are **relative to the user's BasePath**.
// The SDK lazily fetches base_path via /api/me on first use and
// forwards paths to AList, which enforces per-user containment server-side.
const { data } = await client.list("/");           // lists own root folder
await client.upload("/photos/sunset.jpg", fileBlob);
const blob = await client.download("/photos/sunset.jpg");
```

## Path semantics (v1.0 — breaking change)

Starting with v1.0, paths passed to SDK methods are **resolved relative to the authenticated user's BasePath**. Callers no longer need to (and cannot) include their own identity id in the URL.

| Input path | Behaviour |
|------------|-----------|
| `"/"` or `""` | Returns the user's BasePath root (the `/\<identity_id\>` folder). |
| `"photos/sunset.jpg"` (no leading slash) | AList auto-prefixes BasePath server-side → `/\<identity_id\>/photos/sunset.jpg`. |
| `"/photos/sunset.jpg"` (leading slash) | Treated as absolute; **must** be inside BasePath or the server returns 403. |
| `"/<other_identity_id>/..."` | Always rejected with 403 (BasePath containment). |

The SDK never sends the literal BasePath prefix; it forwards whatever the caller supplies and lets AList enforce the boundary. The BasePath is discovered automatically via `me()` on first call (cached).

### Migration from v0.x

```diff
- await client.upload("/abc123-id/photos/sunset.jpg", file);
+ await client.upload("/photos/sunset.jpg", file);
```

## API

### User

```ts
const me = await client.me();
// → { id, username, sso_id: "kratos:<identity_id>", base_path: "/<identity_id>", role, ... }
```

### List directory

```ts
const res = await client.list("/", { page: 1, per_page: 50 });
for (const f of res.data.content) {
  console.log(f.name, f.size, f.is_dir);
}
```

### Upload

```ts
// From a browser File (e.g. <input type=file>)
await client.upload("/photos/sunset.jpg", fileFromInput);

// From a Blob
const blob = new Blob([await response.arrayBuffer()]);
await client.upload("/data/file.bin", blob);

// From a Buffer (Node 18+)
const buf = await fs.promises.readFile("./local.pdf");
await client.upload("/docs/report.pdf", buf);
```

### Download

```ts
// Full Blob (small files)
const blob = await client.download("/photos/sunset.jpg");
const url = URL.createObjectURL(blob);

// Pre-signed URL (large files, <img src>, <a href>, window.open)
const presigned = await client.downloadUrl("/photos/sunset.jpg");
window.open(presigned, "_blank");
```

### Other operations

```ts
await client.mkdir("/new-folder");
await client.rename("new-name.jpg", "/old-name.jpg");
await client.remove(["/file1.txt", "/file2.txt"]);
await client.move(["/file.txt"], "/archive/");
await client.copy(["/file.txt"], "/backup/");
const found = await client.search("/", "report", { scope: 0 });
```

## Auth flow

The SDK relies on the **Oathkeeper edge**, not a bearer token:

1. Every request is sent with `credentials: "include"`, so the browser attaches the `ory_kratos_session` cookie. **No `Authorization` header is sent** — the edge's AList mutator blanks it anyway.
2. Oathkeeper's `cookie_session` authenticator validates the cookie against Kratos `/sessions/whoami` and, on success, injects `X-User-Id` + identity traits (and blanks `Authorization`) before forwarding to AList.
3. AList's middleware (`server/middlewares/auth.go`) reads the edge-injected `X-User-Id`. If the identity has no AList user yet, one is auto-provisioned with `BasePath = /<kratos_identity_id>` and `SsoID = "kratos:<kratos_identity_id>"`.
4. The `me()` endpoint returns the cached `base_path`; the SDK stores it internally.
5. All subsequent file operations are scoped to that BasePath by AList's server-side containment check (`internal/model/user.go:JoinPath`).

You never need to log in to AList directly — the Kratos session (validated at the edge) is the single source of truth.

> **Routing note:** the `alistUrl` must be the edge origin **with** the `/.assets/alist` prefix (e.g. `http://localhost:4455/.assets/alist`, or `https://backend.getkawai.com/.assets/alist` in prod). The SDK appends `/api/...`, `/d/...`, `/p/...`, `/ping` to it; without the prefix those paths match no edge rule and return `404`. Direct-to-AList usage (bypassing the edge) is not supported in browser contexts — AList is localhost-only.

## Browser vs Node

The SDK is designed for the **browser**, where the `ory_kratos_session` cookie is present and `credentials: "include"` delivers it to the edge:

- `fromKratosSession(url?)` just constructs a client pointed at the edge; the cookie does the authentication.
- `fetch` and `FormData` are native in browsers and Node 18+.
- No DOM dependencies.

For server-side (Node) use without a browser cookie, talk to AList through the edge with a cookie forwarded manually, or run AList's own admin path out of band — the legacy `kratos:<token>` Authorization scheme is no longer used (the edge blanks `Authorization`).

## Demo

```ts
import { AlistClient } from "alist-kratos-sdk";

const client = await AlistClient.fromKratosSession(); // default edge + prefix

if (!client) {
  // redirect to Kratos login (served behind the same edge)
  window.location.href = "http://localhost:4455/.ory/kratos/public/self-service/login/browser";
} else {
  // render file picker, list/upload, etc.
  const { data } = await client.list();
  console.log(`You have ${data.total} files`);
}
```

## Types

```ts
interface AlistFile {
  name: string;
  size: number;
  is_dir: boolean;
  modified: string;
  created?: string;
  sign?: string;       // pre-signed URL token
  thumb?: string;      // thumbnail URL
  type: number;        // 0=unknown, 1=folder, 2=video, 3=audio, 4=text, 5=image, 6=archive
  hashinfo?: string;
}

interface AlistUser {
  id: number;
  username: string;
  sso_id?: string;       // "kratos:<identity_id>"
  base_path: string;     // "/<identity_id>"
  role: number;
  permission: number;
  disabled: boolean;
  otp?: boolean;
}
```
