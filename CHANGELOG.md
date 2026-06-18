# alist-kratos-sdk

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
