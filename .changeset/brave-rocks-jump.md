---
"alist-kratos-sdk": major
---

Switch to Oathkeeper edge-proxy auth, drop direct Kratos session.

- `fromKratosSession()` now only takes `alistUrl` (defaults to `http://localhost:4455`). The `kratosUrl` and `sessionToken` parameters are removed.
- `AlistClientConfig` no longer accepts `kratosSessionToken`, `kratosUrl`, or `rawAuthHeader`.
- All requests use `credentials: "include"` instead of an `Authorization: kratos:<token>` header, delegating session validation to the Oathkeeper proxy.
- The `readCookie()` and `validateKratosSession()` helpers have been removed.