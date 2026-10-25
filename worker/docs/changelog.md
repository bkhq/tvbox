# Changelog

Tracking history of `docs/task/` and `docs/plan/`. Entries: `## YYYY-MM-DD HH:MM [tag]`.

## 2026-10-17 01:11 [progress]

Task and plan tracking initialised; the two earlier plans (`media-library`, `recommend-home`) are indexed as completed under their existing filenames.

## 2026-10-17 01:30 [decision]

`20261017-0111-tmdb-top-rated-import`: the in-Worker import job was dropped at the user's request; content is loaded through a new bulk import route by a script run locally or from a `workflow_dispatch` workflow. Translations stay one row per locale. The RN client is out of scope.

## 2026-10-17 02:40 [progress]

`20261017-0111-tmdb-top-rated-import` completed. Added `media_title_translations` (migration 0012) with admin routes and a console tab, `translations` in the native detail document and search text, `POST /media/import` (bulk upsert by `tmdb` external id), `scripts/media-import-tmdb.ts` with `scripts/lib/tmdb.ts`, and `.github/workflows/media-import.yml`. Deviations from the plan: a `TMDB_BASE_URL` override exists so the script can be exercised against a stand-in server; none otherwise.

## 2026-10-17 02:10 [decision]

`20261017-0151-media-source-in-d1`: the media library's source tables move from the Durable Object to the `tv-bk-io` D1 database; titles, seasons and people get random bare 12-character ids; no data is carried over (the DO's media tables are dropped).

## 2026-10-17 04:40 [progress]

`20261017-0151-media-source-in-d1` completed. New `modules/media/db.ts` (D1 handle, `runBatch`, `insertRows`), every media write is a `db.batch()`, D1 migration `0002_source_tables.sql` (source tables, `rm_*` tables with text ids, `rm_search.type`), DO migration `0013_drop_media.sql`, backup contributions can name their own database, console and worker take string ids. Gates: `bun run check` and `bun run test:workers` green. After the deploy the read model is empty until the first publish.

## 2026-10-25 01:40 [decision]

`20261025-0124-media-serve-from-source`: after the 2026-10-21 TMDB import every publish ran out of memory in the Durable Object while projecting the whole library. The user chose to drop the read model: the Worker reads the D1 source tables per request, and publishing only marks live title, season and episode ids. Edits to resources that are already live take effect without a publish.

## 2026-10-25 04:30 [progress]

`20261025-0124-media-serve-from-source` implemented; the production deploy and verification are still pending.

- **Publishing.** New `modules/media/publish.ts` (`markPublished`: two set-based statements per kind plus the generation, in one batch) and D1 migration `0003_published.sql`, which adds `media_published` and drops every `rm_*` table.
- **Serving.** The builders moved to `modules/media/serve/` with a per-request `loadSlice`. `workers/media/{query,app,cms,index}.ts` were rewritten over drizzle `MediaDb`; the CMS selects playable movies and seasons in SQL.
- **Removed.** The projector, read-model store, SQLite adapter, the rebuild route and the console's rebuild button.
- **Deviations from the plan.**
  - Drizzle's D1 driver cannot batch raw SQL that carries parameters, so the facets and CMS page reads run as parallel queries, and publish inlines the kind literals.
  - The smoke test now also checks the CMS category list and the facets.
- **Gates.** `bun run check` and `bun run test:workers` (17/17) are green.

## 2026-10-25 19:20 [progress]

`20261025-1834-sync-bun-tpl` completed. The worker was synced with zzci/bun-tpl from `c6f5c58` (the base of the 2026-10-03 import, found by comparing files) to `25c3463`, in six commits:

- **Fixes:** literal LIKE wildcards; client IP behind a trusted proxy in audit events (`auditMeta`, also used by the tvbox and media routes); sliding sessions.
- **API tokens:** rename, rescope and rotate.
- **Helper refactors.**
- **API docs:** an external viewer for `/api/docs`.
- **Dependencies:** TypeScript 7 next to TS 6, eslint config 10, uqr instead of qrcode, a vendored shadcn CSS, a small language detector, and CI on Bun 1.4.4 and Node 24.22.1.
- **Style:** the eslint 10 style pass.

Skipped:

- password accounts and the bootstrap admin (`aea13cb`, `4d78d5d`), at the user's request;
- the DEK challenge refactor, since the worker has no encryption module;
- the attachment routes, which the worker does not use;
- the template's home page and SPA serving;
- lode and the dropped modules.

README records the synced commit. Bun 1.4.4 now enforces `coverageThreshold`; the api suite is at 91.8% of lines and 87.6% of functions against 85% and 70%. Gates: `bun run check` and `bun run test:workers` (17/17) pass.
