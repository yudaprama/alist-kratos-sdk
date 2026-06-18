# alist-kratos-sdk

JavaScript / TypeScript SDK for the AList file API with Ory Kratos authentication. Each user is auto-bound to their Kratos identity; the SDK handles the `kratos:<token>` Authorization header and exposes typed file operations scoped to the user's own folder.

## Install

```bash
npm install alist-kratos-sdk
```

## Quick start

```ts
import { AlistClient } from "alist-kratos-sdk";

// Auto-detect from Kratos session cookie (browser) or pass token (Node)
const client = await AlistClient.fromKratosSession(
  "http://localhost:4433", // Kratos public URL
  "http://localhost:5244"  // AList URL (optional, defaults to localhost)
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

1. The SDK sends `Authorization: kratos:<token>` on every request.
2. AList's middleware (`server/middlewares/auth.go`) detects the `kratos:` prefix and validates the session against the Kratos public API (`/sessions/whoami`).
3. If the identity has no AList user yet, one is auto-provisioned with `BasePath = /<kratos_identity_id>` and `SsoID = "kratos:<kratos_identity_id>"`.
4. The `me()` endpoint returns the cached `base_path`; the SDK stores it internally.
5. All subsequent file operations are scoped to that BasePath by AList's server-side containment check (`internal/model/user.go:JoinPath`).

You never need to log in to AList directly — the Kratos session is the single source of truth. AList just trusts Kratos.

## Browser vs Node

The SDK works in both browsers and Node 18+:

- `fromKratosSession()` reads the `ory_kratos_session` cookie in browsers; in Node pass the token explicitly as the third arg.
- `fetch` and `FormData` are available natively in both runtimes.
- No DOM dependencies.

## Demo

```ts
import { AlistClient } from "alist-kratos-sdk";

const client = await AlistClient.fromKratosSession(
  "http://localhost:4433",
);

if (!client) {
  // redirect to Kratos login
  window.location.href = "http://localhost:4455/login.html";
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
