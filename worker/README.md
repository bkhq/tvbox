# TVBox worker

Cloudflare Worker that serves the TVBox subscription and the app's updates,
and hosts the admin console. Built from
[zzci/bun-tpl](https://github.com/zzci/bun-tpl), trimmed to the modules this
project needs and to the Workers runtime only.

- **Content** — upstream configs (e.g. xiaosa) are imported into our own
  database: each site, parser, live source and rule becomes a row
  we can edit, disable or delete (one by one or in bulk) or reorder, and every file
  they reference (spider jar, `./json/*`) is mirrored into R2. Entries added
  in the admin console belong to no upstream and are common to every device.
  A deleted upstream entry goes to the recycle bin rather than away, so the
  next sync does not import it again; it can be restored from there. Files a
  custom entry needs (a spider jar, an ext json) are uploaded from the entry
  editor and referenced by the path it returns.
  An upstream can also be a collection (`{"urls": [{"name", "url"}, …]}`, the
  multi-line format the app accepts): each line becomes an upstream of its
  own, synced with the collection; a line it drops is deleted, and a device
  that picks the collection follows every line.
  The "TVBox sources" workflow syncs every six hours, probes every entry
  and disables dead ones before publishing (the built-in timer,
  `TVBOX_SYNC_INTERVAL_MINUTES`, is off in production); entries edited here
  keep their edits. Publishing stores a snapshot in R2.
- **Devices** — each device has its own subscription URL,
  `/s/<token>/api.json`, which the admin console can show again or
  regenerate. A device follows every upstream or a chosen few; the stateless
  Worker composes its config from the published snapshot (its upstreams plus
  the common entries) and serves mirrored files
  (`/s/<token>/a/<sha256>/<name>`) without waking the Durable Object.
- **App updates** — `/u/<channel>/<mode>-<abi>.json` and
  `/u/apk/<versionCode>/<mode>-<abi>.apk`, public. CI uploads the APKs of a
  tagged build to R2 and registers the release; the admin console can move a
  release between stable and beta, withdraw it or delete it.
- **Admin console** — React SPA on the asset pipeline, Hono API in one Durable
  Object that owns its SQLite database. Modules: account (OIDC login, TOTP,
  API tokens, users, groups), audit, settings, backup, file (R2),
  system, tvbox.

## URLs

| Path | What |
| --- | --- |
| `/` | public download page: the APKs of the newest stable release |
| `/mg/` | admin console (`BASE_PATH`); its API is `/mg/api`, the raw API `/mg/api/raw` |
| `/s/<token>/` | a device's subscription |
| `POST /api/raw/tvbox/enroll` | the app's Server link endpoint; the only API path at the root (see `docs/SERVER-LINK.md`) |
| `/u/<channel>/<mode>-<abi>.json`, `/u/apk/…` | app updates |
| `/dns-query` | DNS-over-HTTPS, forwarded to Cloudflare |

Every request reaches the Worker first (`run_worker_first = true`), which
routes them in `apps/api/src/workers/router.ts`; only `/mg/api` and the
enroll endpoint wake the Durable Object. Nothing public links to `/mg`, and
its pages are served `noindex`. The SPA is built into `apps/web/dist/mg/`.

## Layout

```text
apps/api/        Hono API + Workers entry (src/workers/entry.ts)
  src/modules/tvbox/   upstream sync, entries, publishing, devices, releases
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
upstream under Content → Upstreams, sync, publish, and add a device.

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
`https://tv.bk.io/mg/api/account/auth/callback` as the client's redirect URI.
The workers.dev URL stays reachable for subscriptions, but logins only work
on the configured origin.

A manual deploy is `bun run deploy`.

## Managing upstreams from CI

`tvbox/upstreams.json` declares the upstreams:

```json
[{ "name": "xiaosa", "url": "https://…/api.json", "primary": true, "sync": true }]
```

`tvbox/doh.json` lists the DoH resolvers every device gets, and
`tvbox/spider.json` pins the top-level spider to `spider/xiaosa/spider.jar`
in the repo: xiaosa's jar as of when it was copied, so a new upstream jar
never goes out unreviewed. To update it, replace that file (xiaosa's sites
may start naming classes only a newer jar has, which the health check cannot
see) and push.

`.github/workflows/tvbox.yml` runs `scripts/tvbox-apply.ts --check` every six
hours, when that file changes, or by hand (Actions → TVBox sources → Run
workflow). It creates or updates each declared upstream (matched by URL),
syncs them, probes every entry (`scripts/tvbox-health.ts`: failing entries
are disabled, recovered ones re-enabled, ones forced on in the console only
recorded), and publishes when anything changed; the manual run can also
skip the check, or publish always or never. The probe report is uploaded as
the `health-report` artifact.
Upstreams added only in the admin console are left alone. It needs the
secret `TVBOX_API_TOKEN`: an admin's API token with the `tvbox:write` scope,
created under Settings → API tokens. Locally:

```bash
TVBOX_URL=https://tv.bk.io/mg TVBOX_API_TOKEN=… bun run tvbox:apply
```

## Releasing the app

`.github/workflows/android.yml` handles tags named `vX.Y.Z`: versionCode is
`X*10000 + Y*100 + Z`, the update URL baked into the APK is
`${WORKER_URL}/u`, and the APKs are uploaded to R2 and registered with the
worker. It needs the repository variable `WORKER_URL` and the secrets
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` and `SERVICE_TOKEN_RELEASE`
(the same value as the Worker secret). The tag message becomes the release
notes.
