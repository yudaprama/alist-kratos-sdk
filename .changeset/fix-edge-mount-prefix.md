---
"alist-kratos-sdk": patch
---

Fix `fromKratosSession` default URL to include the `/.assets/alist` mount prefix.

AList now lives behind the Ory Oathkeeper edge at `/.assets/alist/*` (its `site_url`
sub-path). The SDK appends `/api/me`, `/d/...`, `/ping` to `alistUrl`, so the previous
default `http://localhost:4455` produced paths that matched no edge rule (alist rules
require the prefix; `prest-authenticated` excludes `api/`) and returned `404`. The
default is now `http://localhost:4455/.assets/alist`.

Docs (README, CLAUDE.md) are also synced to the cookie/edge auth model: the SDK sends
`credentials: "include"` and no `Authorization` header (the edge validates the Kratos
cookie and blanks `Authorization`), replacing the stale `kratos:<token>` / two-arg
`fromKratosSession(kratosUrl, alistUrl)` documentation.
