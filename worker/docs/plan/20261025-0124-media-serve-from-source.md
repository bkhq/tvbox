# 20261025-0124-media-serve-from-source Serve the media library straight from the D1 source tables

- **status**: implementing
- **createdAt**: 2026-10-25 01:24
- **approvedAt**: 2026-10-25 01:40
- **relatedTask**: 20261025-0124-media-serve-from-source

## Context

- Since `20261017-0151-media-source-in-d1`, the `tv-bk-io` D1 database (binding `MEDIA`) holds both the source tables (`media_*`, written by the console and `POST /media/import`) and the read model (`rm_*`, read by the Worker under `/s/<token>/media`).
- `tvbox/publish.service.ts#publish` runs `projectLibrary` first. That function lives in `readmodel/projector.service.ts` with `documents.ts` and `cms.ts`. It reads every `media_*` table whole (`loadLibrary`) and builds every document in memory (`buildReadModel`). It then accumulates all write statements before flushing them.
- After the 2026-10-21 TMDB import, production holds 4944 titles, 8719 seasons, 42.5k people, 74.6k credits and 48.5k images. Every publish now dies with `exceededMemory` in the Durable Object (128 MB; observed with `wrangler tail`). Because projection runs before the snapshot is written, the subscription config cannot be published either. Devices still get the last published snapshot and the 40-title read model.
- The Worker read path is split across two pieces. `workers/media/index.ts` covers generation, caching and asset rewriting; `app.ts` and `query.ts` cover v1; `cms.ts` and `live.m3u` read `rm_*` only (`ReadModelDb`, raw `prepare`). Responses are stored JSON documents spliced as strings.
- The document shapes are fixed by `modules/media/contract.ts` and must not change. They cover card, title detail, season detail, playback, person, collection, home, facets, manifest and live. `documents.ts` already holds the pure builders for all of them; it only assumes it gets the whole library.
- Other users of the read model:
  - the console's "rebuild read model" (`readmodel.routes.ts`, `-media-publish.tsx`, locales);
  - `live.service.ts` (`buildLive`);
  - `workers/subscription.ts` (`MediaDatabase`);
  - `entry.ts` (`setReadModelDb`);
  - `media.test.ts`, `cms.test.ts`, `projector.test.ts` and `tests/workers/smoke.ts`;
  - `docs/reference/api-routes.md`.
- The RN client does not use the media API yet (no references under `client/src`), so the HTTP shapes have no external consumer beyond TVBox CMS parsing.
- User decisions (2026-10-25):
  - no projection, so the Worker reads the source tables;
  - publishing decides which resources are live;
  - resources barely change, so publishing only marks them by id.

## Proposal

### 1. Publish marks resources by id

- **New D1 table** (migration `d1/media/0003_published.sql`, which also drops every `rm_*` table):

  ```sql
  CREATE TABLE media_published (id TEXT PRIMARY KEY, kind TEXT NOT NULL);  -- 'title' | 'season' | 'episode'
  CREATE INDEX idx_media_published_kind ON media_published (kind);
  ```

- **`publish()` becomes `markPublished(media)`**: a single `db.batch()` with constant memory. It inserts newly published ids and deletes ids that are no longer published:
  - per kind: `INSERT OR IGNORE INTO media_published SELECT id, '<kind>' FROM media_<table> WHERE publish_state = 'published'`;
  - per kind: `DELETE FROM media_published WHERE kind = '<kind>' AND id NOT IN (SELECT id FROM media_<table> WHERE publish_state = 'published')`;
  - it then writes the `published_generation` setting (a ULID) last.
- Only ids that changed are written. The snapshot write follows as today.
- **What publishing gates:** a title, season or episode reaches devices only after a publish has marked it.
- **What goes live at once:** edits to an already-marked resource (metadata, lines, streams, images, credits), plus taxonomy, rows, hero and live channels. Within the 60 s cache age, devices see these without a publish. Publishing also bumps the generation, so caches turn over immediately.

### 2. The Worker queries the source tables per request

- **Handle and request scope:**
  - `workers/media/*` gets a drizzle `MediaDb` over `env.MEDIA` instead of `ReadModelDb`, so the tests run on the existing libsql `openTestDb()`.
  - Every query joins `media_published`.
  - A request touches only the ids it returns, at most 50 per list. `IN` lists stay under D1's 100-parameter limit.
- **`documents.ts` → `slice.ts`:**
  - `loadSlice(db, titleIds, { credits })` loads only those titles' rows: genres, aliases, translations, external ids, title images, seasons, episodes, enabled sources, streams, and optionally credits, people and their profile images.
  - The existing builders, split per entity, turn a slice into cards, title details, season details, playback documents and CMS items. The code that today runs over the whole library then runs over at most a page of titles.
- **Endpoints:**

  | Endpoint | Source |
  |---|---|
  | `/v1/browse` | `media_titles` ⋈ `media_published` filtered by category, type, year (`substr(release_date,1,4)`), country (`json_extract(origin_countries,'$[0]')`) and genre (`media_title_genres`); keyset paging on popularity, vote average, release date, updated, manual; cards from a slice of the page |
  | `/v1/facets`, `/v1/manifest` | `GROUP BY` over the published titles; dictionaries from taxonomy |
  | `/v1/home`, `/v1/rows/:id` | hero setting and `media_rows`; manual rows read `media_row_items`, rule rows run the browse query with the rule; cards from one slice |
  | `/v1/titles/:id`, `/v1/seasons/:id`, `/v1/playback/:id` | slice of one title with credits; 404 unless marked |
  | `/v1/people/:id` | person, profile, and credits joined with published titles (cards from a slice, capped at 100 titles) |
  | `/v1/collections/:id` | the collection's published titles |
  | `/v1/search` | `LIKE` over title, original title, translations and aliases of published titles, and over person names of people credited in them; queries shorter than 1 character are rejected as today |
  | `/v1/live/channels`, `/live.m3u` | the live tables (small) through `buildLive` |
  | `/cms` | home classes and filters from the facet queries. List, category and search use the published playable items: movies with a stream on an enabled line, and seasons with an aired, published, streamed episode. These come from one SQL query with `EXISTS`, paged 20 at a time by updated time. Details build `vod_play_from` / `vod_play_url` from a slice. |

- **Caching:**
  - `handleMedia` reads `published_generation` instead of `rm_meta.generation`, so a 503 `NOT_PUBLISHED` appears until the first publish.
  - It keeps the per-isolate 10 s generation cache, the shared cache keyed by URL plus generation (60 s), ETag and 304, `no-store` for playback, and the `@a/` asset rewrite.
- **Search change:** a title is no longer found by the names of its cast; people are found by name directly.

### 3. Removals and console

- **Removed code:** `readmodel/projector.service.ts`, `store.ts`, `sqlite-adapter.ts`, `readmodel.routes.ts` (`POST /media/readmodel/rebuild`), `setReadModelDb` in `entry.ts`, and the `ReadModelDb` part of `MediaDatabase`.
- **Moved code:** `names.ts`, `cms.ts` (play-list building) and the builders stay, under `modules/media/readmodel/` renamed to `modules/media/serve/`.
- **Console publish tab:** the rebuild button and its locale keys go. The description says publishing makes newly published titles live and that edits to live titles show within a minute.

### 4. Tests and verification

- **New test first (RED):** publishing a library sized like production succeeds without loading it. It seeds 5000 titles, 40k people and 75k credits through batched inserts into libsql and checks `media_published` counts and the generation. A second test checks that a draft title edited to published is invisible until `markPublished`.
- **Ported tests:** `media.test.ts` and `cms.test.ts` move to `openTestDb()` and keep their assertions on response shapes. `projector.test.ts` becomes `slice.test.ts`: documents built from slices, plus air-date gating and next-episode chaining.
- **Gates:** `bun run check` (coverage gate) and `bun run test:workers` (smoke: publish, browse, search, CMS detail, live.m3u, injection).
- **Production:**
  - deploy (manual dispatch) and publish through the console token;
  - check the device endpoints against the 4944 imported titles;
  - watch CPU per request with `wrangler tail` on browse, facets, CMS home and search.

## Risks

- **D1 reads per request rise:** queries scan up to ~5k titles, or ~42k people for a person search, instead of reading precomputed rows. Two things contain this: the shared cache (60 s per URL and generation), and keeping per-request work to one page. Facets and manifest are the heaviest at a few thousand rows each. If needed, an index on `media_titles (publish_state, category_id, popularity)` and friends can be added in the same migration.
- **Edits to live resources skip the publish gate.** This follows the user decision but changes the console's meaning of "publish". The publish tab copy says so.
- **Migration:** `0003` drops `rm_*` on deploy. The new code never reads them, and the old code is gone in the same deploy.
- **Search quality:** `LIKE` has no ranking and no cast-name matching. Ordering is popularity descending, which is acceptable for a catalogue of this size.
- **CPU per request:** building a page of cards from a slice is small. Title detail with 50 cast and images is bounded by one title.

## Scope

- **API:**
  - `workers/media/{index,app,query,cms}.ts` (rewritten queries);
  - `modules/media/readmodel/*` (→ `serve/`: `slice.ts`, builders, `cms.ts`, `names.ts`; projector, store, adapter and routes removed);
  - `modules/media/{index,schema}.ts`, `modules/media/publish.ts` (new, `markPublished`);
  - `modules/tvbox/publish.service.ts`, `live/live.service.ts` (import path);
  - `workers/{entry,subscription}.ts`, `d1/media/0003_published.sql`, tests.
- **Web:** `-media-publish.tsx`, `-media-api.ts`, `locales/{zh,en}/media.json`.
- **Docs:** `docs/reference/api-routes.md` (generated), `README.md` architecture paragraph, `docs/plan/media-library.md` deviation note.
- **Estimate:** about 15 files changed, net code reduction (the projector's diffing and write planning go away).

## Alternatives

- **A. Keep the projection, chunk it** (process 200 titles at a time, run it from an alarm, publish the config first). This keeps reads precomputed but keeps two copies of the data and a multi-minute first projection. Rejected by the user.
- **C. Project on write** (each console or import write updates the affected `rm_*` rows). Publishing is instant, but every write path and the import pay for projection. Not chosen.
- **Published flag as a column on each source table** instead of `media_published`. That means three `ALTER TABLE`s and the same queries. A separate table keeps "what is live" apart from "what the editor set", and lets publishing diff with two statements per kind. Proposed: the table.

## Annotations

(none yet)
