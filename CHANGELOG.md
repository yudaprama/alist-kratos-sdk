# alist-kratos-sdk

## 2.0.1

### Patch Changes

- 2d08cd9: Fix `fromKratosSession` default URL to include the `/.assets/alist` mount prefix.

  AList now lives behind the Ory Oathkeeper edge at `/.assets/alist/*` (its `site_url`
  sub-path). The SDK appends `/api/me`, `/d/...`, `/ping` to `alistUrl`, so the previous
  default `http://localhost:4455` produced paths that matched no edge rule (alist rules
  require the prefix; `prest-authenticated` excludes `api/`) and returned `404`. The
  default is now `http://localhost:4455/.assets/alist`.

  Docs (README, CLAUDE.md) are also synced to the cookie/edge auth model: the SDK sends
  `credentials: "include"` and no `Authorization` header (the edge validates the Kratos
  cookie and blanks `Authorization`), replacing the stale `kratos:<token>` / two-arg
  `fromKratosSession(kratosUrl, alistUrl)` documentation.

## 2.0.0

### Major Changes

- 6d17cb7: Switch to Oathkeeper edge-proxy auth, drop direct Kratos session.

  - `fromKratosSession()` now only takes `alistUrl` (defaults to `http://localhost:4455`). The `kratosUrl` and `sessionToken` parameters are removed.
  - `AlistClientConfig` no longer accepts `kratosSessionToken`, `kratosUrl`, or `rawAuthHeader`.
  - All requests use `credentials: "include"` instead of an `Authorization: kratos:<token>` header, delegating session validation to the Oathkeeper proxy.
  - The `readCookie()` and `validateKratosSession()` helpers have been removed.

## 1.0.0

### Major Changes

- 924cedc: Paths are now relative to the authenticated user's BasePath.

  AList (after security fix) rejects absolute paths outside the user's
  BasePath and resolves relative paths against BasePath. The SDK now
  auto-discovers the user's base folder via `me()` and forwards paths
  as-is, so callers only ever deal with paths inside their own folder.

  Before:

  ```ts
  await client.upload("/abc123-id/photos/sunset.jpg", file);
  ```

  After:

  ```ts
  await client.upload("/photos/sunset.jpg", file);
  // auto-resolved by AList to /abc123-id/photos/sunset.jpg
  ```

  Manual paths outside the user's BasePath will now return 403, matching
  AList's server-side enforcement.

  Auto-discovery requires the `fromKratosSession` static factory or a
  single `await client.me()` after construction. The constructor accepts
  the same options as before; the `basePath` field is set lazily on the
  first call.

## 0.2.0

### Minor Changes

- 7b582d4: Initial public release of the Alist + Ory Kratos SDK.
