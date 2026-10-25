# 20261025-0124-media-serve-from-source Serve the media library straight from the D1 source tables

- **status**: in_progress
- **priority**: P0
- **owner**: claude/session-8665717e
- **createdAt**: 2026-10-25 01:24

## Description

Publishing fails in production since the TMDB import (4944 titles, 42k people): the read-model projection loads the whole library into the Durable Object and exceeds its memory limit, and because the projection runs first, the subscription config cannot be published either. The user chose to drop the projection: the Worker answers `/media/*` from the `media_*` source tables, and publishing only marks which resources are live, by id.

Acceptance: publish succeeds with the production-sized library in constant memory; `/media/v1/*`, `/media/cms` and `/media/live.m3u` keep their response shapes; the `rm_*` tables and the projector are gone; `bun run check` and `bun run test:workers` pass.

## ActiveForm

Serving the media library from the D1 source tables

## Dependencies

- **blocked by**: (none)
- **blocks**: (none)

## Notes

Plan: docs/plan/20261025-0124-media-serve-from-source.md
