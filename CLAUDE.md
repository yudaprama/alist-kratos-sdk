# alist-kratos-sdk

JavaScript / TypeScript SDK for the AList file API with Ory Kratos authentication.

## Repository

- GitHub: https://github.com/yudaprama/alist-kratos-sdk
- npm: https://www.npmjs.com/package/alist-kratos-sdk
- Base branch: `master`
- Node: 20

## Project layout

```
src/                 TypeScript source (entry: src/index.ts)
dist/                Build output (gitignored)
.changeset/          Changeset markdown files (one per unreleased change)
.github/workflows/   GitHub Actions release.yml
.npmrc               Auth for npm publish (uses NPM_TOKEN)
package.json         Version, scripts, deps
```

## Build

```bash
npm ci                # install (CI uses lockfile)
npm run build         # tsc -> dist/
```

## Release workflow

Publishing is fully automated via **changesets** + GitHub Actions. **Do not run `npm version` or push tags manually.**

### How a release happens

1. A PR or direct push to `master` contains one or more `.changeset/<name>.md` files.
2. The `Release` workflow runs on push to `master`:
   - **If a "Version Packages" PR is already open**, it updates that PR with the new changesets.
   - **If no PR is open**, it creates one titled `chore(release): version packages`. This PR:
     - bumps `version` in `package.json` (consuming the changesets)
     - regenerates `CHANGELOG.md`
     - deletes the consumed changeset files
3. When a maintainer **merges the "Version Packages" PR**:
   - The same workflow runs on the merge commit
   - There are no more pending changesets, so it skips versioning and runs `npm run release` (`tsc` + `changeset publish`)
   - npm publish uses the `NPM_TOKEN` secret (granular token with **Bypass 2FA** enabled)

### Authoring a changeset

When a PR changes user-facing behavior, add a file under `.changeset/`:

```bash
npm run changeset
```

…or create the file manually:

```markdown
---
"alist-kratos-sdk": minor
---

Describe what changed and why. This text goes into CHANGELOG.md and the GitHub release notes.
```

Bump levels:
- `patch` — bug fix, internal refactor
- `minor` — new feature, backward-compatible
- `major` — breaking change

Skip a changeset for docs-only or CI-only changes.

### One-time setup (already done)

- `NPM_TOKEN` secret in repo Settings → Secrets → Actions (granular token, Bypass 2FA, Publish scope)
- Repo Settings → Actions → General → Workflow permissions: **Read and write permissions**, **Allow GitHub Actions to create and approve pull requests** enabled
- `NPM_TOKEN` env var is passed to the workflow and consumed by the repo's `.npmrc`

### Triggering the first publish (no "Version Packages" PR exists yet)

This already happened, but for reference:

1. Ensure at least one `.changeset/*.md` exists on `master`.
2. Push to `master` → workflow opens the "Version Packages" PR.
3. Review the PR (version bump, CHANGELOG entries look right).
4. Merge it → workflow publishes to npm.

### Manual override (emergency only)

If the workflow is broken and you must publish from a local machine:

```bash
# One-time: log in to npm
npm login

# Bump version + tag (must match what would have been generated)
# e.g. for 0.3.0 with changesets:
npm run version-packages     # applies pending changesets locally
npm run release              # builds + publishes
git push --follow-tags
```

**Do not do this routinely** — it bypasses the CHANGELOG PR review and risks drift between the GitHub tag and the npm version.

## Secrets & tokens

| Secret | Used by | Notes |
|---|---|---|
| `NPM_TOKEN` | Release workflow | Granular token, Bypass 2FA, Publish scope. Rotate if leaked: https://www.npmjs.com/settings |
| `GITHUB_TOKEN` | Release workflow | Auto-provided by GitHub Actions; needs write perms + PR creation enabled at repo level. |

## Common tasks

| Task | Command |
|---|---|
| Add a changeset interactively | `npm run changeset` |
| Preview the next version locally | `npm run version-packages -- --snapshot` |
| Build types only | `npm run build` |
| Watch TS | `npm run dev` |
| Inspect a workflow run | `gh run list --repo yudaprama/alist-kratos-sdk --workflow=release.yml` |
| View logs | `gh run view <id> --repo yudaprama/alist-kratos-sdk --log` |
| Re-run a failed workflow | `gh run rerun <id> --repo yudaprama/alist-kratos-sdk` |

## Troubleshooting

- **`E404 Not Found` on publish** — `NPM_TOKEN` not reaching the publish step. Confirm `.npmrc` uses `//registry.npmjs.org/:_authToken=${NPM_TOKEN}` and the env var is set on the `changesets/action` step.
- **`E403 ... 2FA required`** — The token was generated without "Bypass 2FA". Regenerate a granular token with that option enabled.
- **`GitHub Actions is not permitted to create or approve pull requests`** — Repo Settings → Actions → General → Workflow permissions: enable "Allow GitHub Actions to create and approve pull requests".
- **No "Version Packages" PR appears** — No `.changeset/*.md` files exist on `master`. Add one (e.g. `.changeset/fix-typo.md` with a `patch` entry) and push.
- **`npm ci` fails: lockfile out of sync** — Run `npm install` locally, commit `package-lock.json`, push.

## SDK API quick reference

```ts
import { AlistClient } from "alist-kratos-sdk";

// Auto-detect from Kratos session cookie
const client = await AlistClient.fromKratosSession(
  "http://localhost:4433",  // Kratos public URL
  "http://localhost:5244",  // AList URL
);

// Or pass a token directly
const client = new AlistClient({
  alistUrl: "http://localhost:5244",
  kratosSessionToken: "kRatos_sess_abc123...",
});

await client.me();
await client.list("/", { page: 1, per_page: 50 });
await client.upload("/photos/sunset.jpg", fileOrBlobOrBuffer);
const blob = await client.download("/photos/sunset.jpg");
const presigned = await client.downloadUrl("/photos/sunset.jpg");
await client.mkdir("/new-folder");
await client.rename("new.jpg", "/old.jpg");
await client.remove(["/file1.txt", "/file2.txt"]);
await client.move(["/file.txt"], "/archive/");
await client.copy(["/file.txt"], "/backup/");
const found = await client.search("/", "report", { scope: 0 });
```

See `README.md` for full type definitions and the auth flow.
