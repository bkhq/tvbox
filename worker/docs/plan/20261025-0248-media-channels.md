# 20261025-0248-media-channels Show media titles per device channel

- **status**: proposed
- **createdAt**: 2026-10-25 02:48
- **relatedTask**: 20261025-0248-media-channels

## Context

- After `20261025-0124-media-serve-from-source` the Worker answers `/s/<token>/media/*` straight from the D1 `media_*` tables. A title is live when `LIVE_TITLE` in `workers/media/query.ts` holds: it is marked in `media_published`, and a series also needs a marked season. Every list, slice, CMS, search, person and collection query goes through that one condition, or through `loadSlice`, which joins `media_published`.
- Publishing (`markPublished`) only rewrites `media_published` and bumps `published_generation`. Edits to live resources already show without a publish, so the marker table only delays newly published titles.
- Devices live in the Durable Object (`tvbox_tokens`, `tvbox_device_upstreams`). `writeDevicesFile` copies them to the R2 `DEVICES_KEY` file, `{ devices: { <sha256(token)>: { id, upstreams, bindings? } } }`. `handleSubscription` reads that file for every `/s/<token>/…` request, so it already knows the device when it calls `handleMedia`.
- `handleMedia` caches responses in the shared cache keyed by URL (without token) plus generation, so every device shares one entry.
- The project has two unrelated uses of the word "channel": live TV channels (`media_live_channels`) and app release channels (`stable`/`beta`). Neither is touched here.
- User decisions (2026-10-25):
  - titles are visible per device channel;
  - a new channel entity is created, and each device belongs to one channel (option A);
  - `media_published` is dropped and `publish_state` alone decides what is live.

## Proposal

### 1. Channels and title visibility (D1)

- **Migration** `d1/media/0004_channels.sql`:

  ```sql
  CREATE TABLE media_channels (id TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE media_title_channels (title_id TEXT NOT NULL REFERENCES media_titles(id) ON DELETE CASCADE,
    channel_id TEXT NOT NULL REFERENCES media_channels(id) ON DELETE CASCADE, PRIMARY KEY (title_id, channel_id));
  CREATE INDEX idx_media_title_channels_channel ON media_title_channels (channel_id);
  DROP TABLE media_published;
  ```

- **Visibility rule:**
  - A title with no rows in `media_title_channels` is visible on every channel.
  - A title with rows is visible only to devices whose channel is listed.
  - A device without a channel (or with a deleted one) sees only unrestricted titles.
  - Seasons and episodes follow their title.
- **Admin API** (`modules/media/taxonomy`):
  - `GET/POST/PATCH/DELETE /media/channels`;
  - a title's `channelIds` in the title create/update/detail payloads;
  - `POST /media/import` leaves channels untouched.

### 2. A device's channel (Durable Object)

- **DO migration** `0014_device_media_channel.sql`: `ALTER TABLE tvbox_tokens ADD COLUMN media_channel TEXT`.
- **Not a foreign key:** channels live in D1. The admin route checks that the id exists when it is set, and deleting a channel leaves stale ids that behave as "no channel".
- **Devices file:** `writeDevicesFile` adds `channel?: string` to each entry.
- **Channel changes:** saving a device rewrites the file, as upstream changes already do.

### 3. Serving by channel

- **`handleSubscription`** passes the device's `channel` to `handleMedia`.
- **`LIVE_TITLE` becomes a function of the channel:**

  ```sql
  t.publish_state = 'published'
  AND (t.kind = 'movie' OR EXISTS (SELECT 1 FROM media_seasons s WHERE s.title_id = t.id AND s.publish_state = 'published'))
  AND (NOT EXISTS (SELECT 1 FROM media_title_channels c WHERE c.title_id = t.id)
       OR EXISTS (SELECT 1 FROM media_title_channels c WHERE c.title_id = t.id AND c.channel_id = :channel))
  ```

  `loadSlice`, the CMS playable query and the person and collection queries take the same channel. Season and episode filtering uses `publish_state` instead of `media_published`.
- **Bindings:** the v1 app (`MediaBindings`) and `handleCms` carry `channel`. A title detail, season, playback or person request for a title hidden from the channel answers 404, like an unknown id.
- **Cache:**
  - The shared cache key gains `&__c=<channel or ->`, so devices on the same channel share entries.
  - The ETag becomes `"<generation>.<channel>"`.

### 4. Generation without a publish step

- **What replaces `markPublished`:** with `media_published` gone, publishing has nothing to mark in the library, so `markPublished` and `publish.ts` are removed. `tvbox/publish.service.ts#publish` goes back to publishing the subscription config only.
- **Generation bumps:** the cache generation (`media_settings.published_generation`, renamed `generation`) is bumped by one middleware on the media admin router after every successful non-GET request. This covers all write routes and the import in one place, so changes show at once instead of after the 60 s cache age.
- **No generation yet:** `handleMedia` treats a missing generation as `"0"` instead of answering 503. The library is visible as soon as anything is published, and `NOT_PUBLISHED` goes away.

### 5. Console

- **Media → Channels:** a list of channels (name and sort; add, rename, delete), next to the categories and genres tabs.
- **Title editor:** a "visible to" multi-select. Empty means all channels.
- **Devices page:** a channel select per device, with "none" meaning unrestricted titles only.
- **Publish tab copy:** titles go live when they are set to published. Limiting a title to a test channel previews it before everyone sees it.
- **Locales:** zh and en.

### 6. Tests and verification

- **New tests first (RED):**
  - Title visibility: unrestricted, restricted, device without a channel, and a deleted channel. Cover browse, search, detail 404, CMS category and facets counts.
  - Cache keys differ per channel.
  - The devices file carries `channel`.
- **Ported tests:** `publish.test.ts` is removed. `media.test.ts`, `cms.test.ts` and `serve/documents.test.ts` stop calling `markPublished`.
- **Gates:** `bun run check`, then `bun run test:workers`, where the smoke test sets a channel on a device and checks that a restricted title is hidden from another device.
- **Production:**
  - deploy (manual dispatch), which applies D1 `0004` and DO `0014`;
  - check browse, CMS and search with the 4944 imported titles (all unrestricted, so nothing changes for existing devices).

## Risks

- **Schema changes:** D1 `0004` drops `media_published`, and DO `0014` adds a column. Both are forward-only. The code shipped with them no longer reads `media_published`.
- **Query cost:** two `EXISTS` subqueries per title on an indexed table. Most titles have no channel rows, so the `NOT EXISTS` check short-circuits.
- **Cross-database ids:** device channel ids are not enforced by a foreign key. A stale id falls back to "no channel" rather than failing.
- **Visibility depends on the token:** media endpoints check the token, not the device binding. Channels separate audiences; they are not access control.
- **Generation bumps:** every console save moves the generation and empties the shared cache for all channels. With a catalogue that rarely changes, this is acceptable.

## Scope

- **API:**
  - `d1/media/0004_channels.sql`;
  - DO migration `0014`;
  - `modules/media/{schema,index}.ts`, new channels service and routes;
  - title service, routes and contract (`channelIds`);
  - `serve/slice.ts`;
  - `workers/media/{query,app,cms,index}.ts`, `workers/subscription.ts`;
  - `modules/tvbox/{schema,devices.service,publish.service}.ts` and the device routes;
  - `publish.ts` removed; tests.
- **Web:**
  - media channels tab;
  - title editor field;
  - devices page select;
  - publish tab copy;
  - zh and en locales.
- **Docs:**
  - `docs/reference/api-routes.md` (generated);
  - the `docs/plan/media-library.md` deviation note;
  - README media paragraph.
- **Estimate:** about 25 files.

## Alternatives

- **Visibility groups, several per device:** this is more flexible, but the cache key becomes a group combination. Not chosen; the user picked one channel per device.
- **Reuse device upstreams as channels:** no new entity is needed, but upstreams name config sources, and a device can have several. Not chosen.
- **Reuse the app release channel (`stable`/`beta`):** the server does not know a device's release channel, and it only fits the preview use case. Not chosen.
- **Keep `media_published` as a publish gate next to channels:** this gives two overlapping gates. A test channel covers previewing. Not chosen.

## Annotations

- 2026-10-25, user:
  - the published subscription snapshot (current and history) and a device lookup table move to D1 as part of this work, replacing the R2 `PUBLISHED_KEY` and `DEVICES_KEY` objects;
  - a device's channel lives in that D1 table, with a foreign key to `media_channels`;
  - console editing stays in the Durable Object;
  - the proposal is to be revised accordingly before implementation, after `20261025-1834-sync-bun-tpl`.
