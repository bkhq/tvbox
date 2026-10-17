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
