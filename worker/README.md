# TVBox worker

Cloudflare Worker that serves the TVBox subscription and the app's updates,
and hosts the admin console. Built from
[zzci/bun-tpl](https://github.com/zzci/bun-tpl), trimmed to the modules this
project needs and to the Workers runtime only.

- **Subscription** — `/s/<token>/api.json`. Upstream configs (e.g. xiaosa)
  are imported into our own database: each site, parser, live source, rule
  and DoH entry becomes a row we can edit, disable or reorder, and every file
  they reference (spider jar, `./json/*`) is mirrored into R2. Publishing
  writes the composed config to R2; the stateless Worker serves it and the
  mirrored files (`/s/<token>/a/<sha256>/<name>`) without waking the Durable
  Object. Each device has its own token. A scheduled sync pulls every
  sync-enabled upstream (`TVBOX_SYNC_INTERVAL_MINUTES`) and publishes when
  anything changed; entries edited here keep their edits.
- **App updates** — `/u/<channel>/<mode>-<abi>.json` and
  `/u/apk/<versionCode>/<mode>-<abi>.apk`, public. CI uploads the APKs of a
  tagged build to R2 and registers the release; the admin console can move a
  release between stable and beta, withdraw it or delete it.
- **Admin console** — React SPA on the asset pipeline, Hono API in one Durable
  Object that owns its SQLite database. Modules: account (OIDC login, TOTP,
  API tokens, users, groups), audit, settings, backup, file (R2),
  system, tvbox.

## Layout

```text
apps/api/        Hono API + Workers entry (src/workers/entry.ts)
  src/modules/tvbox/   upstream sync, entries, publishing, tokens, releases
  src/workers/         subscription.ts and updates.ts (served from R2)
apps/web/        React 19 SPA (TanStack Router file-based)
packages/        shared tsconfig
tests/workers/   workerd smoke test
docs/            runtime notes, module notes, generated references
```

## Develop

```bash
bun install
cp apps/api/.dev.vars.example apps/api/.dev.vars
bun run dev        # wrangler dev on :8787 + Vite on :5000 (proxies /api)
```

Local development signs in with `smoke` / `smoke-test-password` (the
single-user fixture in `.dev.vars.example`); deployments use OIDC. Add an
upstream under TVBox → Upstreams, sync, publish,
and create a subscription.

Tests run on Bun with a local libsql database; the smoke test boots the real
Worker in workerd and syncs the real xiaosa upstream:

```bash
bun run check          # lint + typecheck + test + build + i18n/env/api-docs drift
bun run test:workers   # workerd smoke
```

## Deploy

`.github/workflows/worker.yml` deploys on every push to `main` once the checks
and the smoke test pass. Everything it needs lives in the GitHub repository
settings. Login is OpenID Connect; secrets ship with each deploy
(`--secrets-file`), the rest is passed as vars.

| Kind | Name | Value |
| --- | --- | --- |
| secret | `CLOUDFLARE_API_TOKEN` | the "Edit Cloudflare Workers" token template, scoped to the account and the `bk.io` zone |
| secret | `CLOUDFLARE_ACCOUNT_ID` | the account the Worker lives in |
| secret | `OAUTH_CLIENT_SECRET` | the OIDC client's secret; leave empty for a public client (PKCE) |
| secret | `SERVICE_TOKEN_RELEASE` | `openssl rand -hex 32`; android.yml registers releases with it |
| variable | `WORKER_URL` | the deployed origin, `https://tv.bk.io`; becomes `APP_URL` and `CORS_ORIGIN` |
| variable | `OAUTH_ISSUER` | the provider's issuer URL (discovery fills the endpoints) |
| variable | `OAUTH_CLIENT_ID` | the OIDC client id |
| variable | `DEFAULT_ADMIN` | comma-separated admins: a verified email or a username |

The Worker is bound to `tv.bk.io` in `apps/api/wrangler.toml`; the zone has
to be on the same Cloudflare account. Register
`https://tv.bk.io/api/account/auth/callback` as the client's redirect URI.
The workers.dev URL stays reachable for subscriptions, but logins only work
on the configured origin.

A manual deploy is `bun run deploy`.

## Releasing the app

`.github/workflows/android.yml` handles tags named `vX.Y.Z`: versionCode is
`X*10000 + Y*100 + Z`, the update URL baked into the APK is
`${WORKER_URL}/u`, and the APKs are uploaded to R2 and registered with the
worker. It needs the repository variable `WORKER_URL` and the secrets
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `SERVICE_TOKEN_RELEASE`
(the same value as the Worker secret). The tag message becomes the release
notes.
