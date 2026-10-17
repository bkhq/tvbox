# 20261017-0111-tmdb-top-rated-import Import TMDB's top-rated movies and series with translations

- **status**: completed
- **priority**: P1
- **owner**: claude/tmdb-import-20261017
- **createdAt**: 2026-10-17 01:11

## Description

Fill the media library from TMDB: about 5000 titles (movies and series) chosen by rating, with their metadata, posters, genres, seasons and main credits, in Chinese first with English (and other configured locales) stored as translations. The library today holds one language per title (`title` / `overview` / `tagline`), so a translations table has to be added first.

Acceptance:

- An admin starts the import from the console with the deployed `TMDB_TOKEN`; it runs in the background, survives Durable Object eviction, reports progress, can be cancelled and re-run (re-runs update, never duplicate).
- Titles arrive in rating order and are published; the CMS list and the native API show them with Chinese titles and overviews where TMDB has them, falling back to Traditional Chinese, then English, then the original.
- Every configured locale TMDB knows is stored per title and exposed through the admin API and the native detail document; translated titles are searchable.

## ActiveForm

Importing TMDB's top-rated titles with translations

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261017-0111-tmdb-top-rated-import.md`.

- complete: Implemented: translations table + routes, bulk import route, TMDB script, workflow. bun run check and test:workers pass; end-to-end verified against a mock TMDB and local wrangler dev.
