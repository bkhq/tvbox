# TVBox worker - Task List

> Updated: 2026-10-25

## Usage

Each task is a single line linking to its detail file. All detailed information lives in `docs/task/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1428-add-endpoint Add endpoint**](20260907-1428-add-endpoint.md) `P1`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Pending |
| `[-]`  | In progress |
| `[x]`  | Completed |
| `[~]`  | Closed / Won't do |
| `[d]`  | Deleted detail file; index entry retained |

### Priority: P0 (blocking) > P1 (high) > P2 (medium) > P3 (low)

### Rules

- Only update the checkbox marker; never delete the line or change its other content. If the detail file is deleted, mark the entry `[d]`.
- Record change history and deletion reasons in `docs/changelog.md`; update affected dependency and plan references.
- New tasks append to the end.
- See each `<timestamp>-<feature-slug>.md` for full details, except `[d]` entries whose files have been deleted; consult `docs/changelog.md` for their history.

---

## Tasks

- [x] [**20261017-0111-tmdb-top-rated-import Import TMDB's top-rated movies and series with translations**](20261017-0111-tmdb-top-rated-import.md) `P1`
- [x] [**20261017-0151-media-source-in-d1 Move the media library's source data from the Durable Object to D1**](20261017-0151-media-source-in-d1.md) `P1`
- [-] [**20261025-0124-media-serve-from-source Serve the media library straight from the D1 source tables**](20261025-0124-media-serve-from-source.md) `P0`
- [~] [**20261025-0248-media-channels Show media titles per device channel**](20261025-0248-media-channels.md) `P1`
- [x] [**20261025-1834-sync-bun-tpl Sync the worker with upstream zzci/bun-tpl changes**](20261025-1834-sync-bun-tpl.md) `P1`
- [x] [**20261025-2028-media-clients Make the media library a standalone library published per client URL**](20261025-2028-media-clients.md) `P1`
