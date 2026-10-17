# 20261017-0151-media-source-in-d1 Move the media library's source data from the Durable Object to D1

- **status**: completed
- **priority**: P1
- **owner**: claude/tmdb-import-20261017
- **createdAt**: 2026-10-17 01:51

## Description

The media library's source tables (`media_*`) leave the Durable Object's SQLite and live in the `tv-bk-io` D1 database next to the read model. The Durable Object keeps every other module (account, audit, tvbox, files, settings, backup) and keeps serving the media admin API, but through a D1 handle: it stores no media data. The read model, its projection, the client-facing media API, the console and the import script stay as they are.

Acceptance:

- Every media admin route and the publish projection work against D1 (local `wrangler dev` and the deployment); the DO's SQLite holds no media tables after the deploy.
- No data is carried over (user decision, 2026-10-17): the DO's media tables are dropped and D1 starts empty.
- Titles, seasons and people have random bare ids; nothing client-facing or in the console parses an id.
- Backup export and restore still cover the media tables.
- `bun run check` and `bun run test:workers` pass; the media test suite runs against the same DDL D1 runs.

## ActiveForm

Moving the media library's source data to D1

## Dependencies

- **blocked by**: 20261017-0111-tmdb-top-rated-import (completed)
- **blocks**: (none)

## Notes

Plan: `docs/plan/20261017-0151-media-source-in-d1.md`.

- complete: Media source moved to D1 with random bare ids; check and smoke gates green
