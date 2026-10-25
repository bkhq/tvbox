# TVBox worker - Plan Index

> Updated: 2026-10-25

## Usage

Each plan is a single line linking to its detail file. All detailed information lives in `docs/plan/<timestamp>-<feature-slug>.md`.

### Format

- [ ] [**20260907-1440-add-endpoint Add endpoint**](20260907-1440-add-endpoint.md) `YYYY-MM-DD`

### Status Markers

| Marker | Meaning |
|--------|---------|
| `[ ]`  | Draft / Pending review |
| `[-]`  | Approved / Implementing |
| `[x]`  | Completed |
| `[~]`  | Rejected / Abandoned |
| `[d]`  | Deleted detail file; index entry retained |

### Rules

- Only update the checkbox marker; never delete the line or change its other content. If the detail file is deleted, mark the entry `[d]`.
- Record change history and deletion reasons in `docs/changelog.md`; update affected task and plan references.
- New plans append to the end.
- See each `<timestamp>-<feature-slug>.md` for full details, except `[d]` entries whose files have been deleted; consult `docs/changelog.md` for their history.

---

## Plans

- [x] [**media-library Own media library in the worker**](media-library.md) `2026-10-12`
- [x] [**recommend-home Recommendation home built by the worker**](recommend-home.md) `2026-10-15`
- [x] [**20261017-0111-tmdb-top-rated-import Import TMDB's top-rated movies and series with translations**](20261017-0111-tmdb-top-rated-import.md) `2026-10-17`
- [x] [**20261017-0151-media-source-in-d1 Move the media library's source data from the Durable Object to D1**](20261017-0151-media-source-in-d1.md) `2026-10-17`
- [-] [**20261025-0124-media-serve-from-source Serve the media library straight from the D1 source tables**](20261025-0124-media-serve-from-source.md) `2026-10-25`
