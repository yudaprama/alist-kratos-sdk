# alist-kratos-sdk

JavaScript / TypeScript SDK for the AList file API with Ory Kratos authentication. Each user is auto-bound to their Kratos identity; the SDK handles the `kratos:<token>` Authorization header and exposes typed file operations.

## Install

```bash
npm install alist-kratos-sdk
```

## Quick start

```ts
import { AlistClient } from "alist-kratos-sdk";

// Option 1: explicit session token (e.g. from your own auth flow)
const client = new AlistClient({
  alistUrl: "http://localhost:5244",
  kratosSessionToken: "kRatos_sess_abc123...",
});

// Option 2: auto-detect from `ory_kratos_session` cookie
const client = await AlistClient.fromKratosSession(
  "http://localhost:4433",  // Kratos public URL
  "http://localhost:5244",  // AList URL (optional)
);

if (!client) throw new Error("No valid Kratos session — user must log in");

// Option 3: shorthand if you have the token string
const client = new AlistClient("kRatos_sess_abc123...");
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

The SDK sends `Authorization: kratos:<token>` on every request. AList's custom middleware (`server/middlewares/auth.go`) detects the `kratos:` prefix, validates the token against the Kratos public API, and auto-provisions an AList user row bound to that identity. The user's `BasePath` is auto-set to `/<kratos_identity_id>`, so they can only read/write their own files.

You don't need to log in to AList directly — the Kratos session is the single source of truth. AList just trusts Kratos.

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
