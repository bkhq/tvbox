# 20261017-0111-tmdb-top-rated-import Import TMDB's top-rated movies and series with translations

- **status**: completed
- **createdAt**: 2026-10-17 01:11
- **approvedAt**: 2026-10-17 01:23
- **relatedTask**: 20261017-0111-tmdb-top-rated-import

## Context

### What exists

- `TMDB_TOKEN` is a GitHub secret and a deployed Worker secret (README, `.github/workflows/worker.yml`); only the stateless recommendation home reads it (`workers/home.ts`, Netflix rows). The Durable Object does not need it under this plan: TMDB is called from the import script, not from the Worker.
- The media library (`modules/media`, plan `media-library.md`) stores source data in the DO's SQLite and publishes a read model into D1 (`readmodel/projector.service.ts`): one `card_json` / `detail_json` per title plus pre-rendered Apple CMS items (`rm_cms_items`). Publishing diffs by hash, in D1 batches of 400 statements.
- Language support today: `media_titles` has one `title`, `original_title`, `overview`, `tagline`. `media_title_aliases` (`name`, `locale`, `kind = alias | translation`) stores other names only; nothing holds a translated overview or tagline. `media_images.locale` exists. `readmodel/names.ts` renders country / language codes in Chinese only. Neither the CMS layer nor the native API take a language parameter.
- `media_external_ids` is unique on `(owner_type, source, external_id)`; TMDB movie and TV ids share one numeric space, so a plain `550` would collide between a movie and a series.
- CI already drives the deployment through the admin API with a personal API token: `scripts/tvbox-apply.ts` + `.github/workflows/tvbox.yml`, `TVBOX_URL` / `TVBOX_API_TOKEN` (`tvbox:write` scope), the `client()` helper in `scripts/tvbox-health.ts` (`Authorization: Bearer`). The media module registers the `media:read` / `media:write` token scopes. The creation rate limit only throttles `POST` routes that have a `GET` list twin, so a dedicated import route is not throttled.
- Default categories: `movie`, `tv`, `anime`, `variety`, `documentary`; genres are seeded as `g<tmdb id>` (`taxonomy.service.ts`).
- The CMS list is ordered by `updated_at DESC`; the native API offers `sort=rating` and rule rows (`{"category", "genre", "sort"}`).
- Services the import route can reuse: `createTitle` / `updateTitle`, `createSeason` / `updateSeason`, `createPerson`, `addCredit`, `addImage`, `addExternalId` / `findByExternalId`, `createCollection`, `refreshSeriesStatus`. Publishing is `POST /tvbox/publishes`, which projects the media read model when a D1 binding exists.

### Why not the daily export

TMDB's daily exports (`files.tmdb.org/p/exports/movie_ids_<MM_DD_YYYY>.json.gz`, `tv_series_ids_…`) list every id with `original_title`, `popularity` and `adult` only. They carry no rating, so "the 5000 best-rated" cannot be picked from them without fetching details for roughly one million movies and 200 thousand series. `/discover/{movie,tv}` with `sort_by=vote_average.desc` and a vote-count floor returns exactly the ranked list, 20 per page, up to page 500; `/top_rated` is that same query with TMDB's own floors (300 votes for movies, 150 for TV). The export stays useful later for popularity-based or full-catalogue imports; this plan does not use it.

## Proposal

Content never ships with a deploy. The Worker gains a translations table and a bulk import route; a Bun script (run locally or by a `workflow_dispatch` GitHub workflow) talks to TMDB, maps the data and writes it through that route, then publishes.

### 1. Translations table (DO SQLite, migration `0012_media_title_translations.sql`)

```ts
export const mediaTitleTranslations = sqliteTable("media_title_translations", {
  id: text("id").primaryKey(),
  titleId: integer("title_id").notNull().references(() => mediaTitles.id, { onDelete: "cascade" }),
  locale: text("locale").notNull(),      // BCP 47 as TMDB spells it: zh-CN, zh-TW, en-US
  title: text("title"),
  overview: text("overview"),
  tagline: text("tagline"),
}, t => [uniqueIndex("idx_media_title_translations_locale").on(t.titleId, t.locale)]);
```

- One row per locale: adding a language later is a value in the import's `--locales` list, no schema change. The columns on `media_titles` stay the display values (Chinese first, see fallback below). `media_title_aliases` is untouched.
- Generated with `bun run db:generate`; added to `media.backup.ts` after `mediaTitleAliases`.
- Admin API: `GET /media/titles/:id/translations`, `PUT /media/titles/:id/translations/:locale` (title / overview / tagline), `DELETE /media/titles/:id/translations/:locale`; `TitleView` gains `translations`. The console's title editor shows them as a small editable list.
- Read model: `TitleDetail` gains `translations: Record<string, { title: string | null; overview: string | null; tagline: string | null }>`; translated titles join the search text, so an English title finds the Chinese card. No `lang` parameter on the native API or CMS in this plan (nothing consumes it yet; see Alternatives).

### 2. Bulk import route (`modules/media/import/`)

Files: `contract.ts` (zod schema of an imported title, no `@/` imports so the script can load it too), `import.service.ts` (upsert of one title with everything attached), `import.routes.ts`.

`POST /media/import` body `{ titles: ImportTitle[] }`, 1 to 50 per call, admin session or `media:write` token. An `ImportTitle` carries: `kind`, `externalIds` (at least `tmdb`), `categoryId`, the title fields of `TitleInput`, `translations[]` (`locale`, `title`, `overview`, `tagline`), `genreIds`, `images[]` (kind, url, locale, width, height), `collection` (`{ externalId, name, overview }` or null), `seasons[]` (number, name, overview, airDate, episodeTotal, poster), `credits[]` (person `{ externalId, name, originalName, profile }`, role, character, department, job), `origin`.

Per title, in one DO transaction:

- Look up `media_external_ids (title, tmdb, <externalId>)`. Missing → create; present with `origin = tmdb` → update (title fields, translations, genres and credits replaced; images added only when the URL is new; seasons matched by number, created or updated, never deleted); present with another origin → `skipped` (admin-owned). `publishState` and `categoryId` of an existing title are kept so console edits survive a re-run.
- People are matched by `media_external_ids (person, tmdb, <id>)`, created on first sight; collections by id `tmdb-c<id>`.
- `updatedAt` is bumped only when a field changed; a created title gets the current time, which is what orders the CMS list.
- Response: `{ results: [{ externalId, id, action: created | updated | skipped }] }`; a title that fails validation fails the whole call (422) so the script notices.

### 3. Script `scripts/media-import-tmdb.ts` (+ `scripts/lib/tmdb.ts` for the pure mapping)

```bash
TVBOX_URL=https://tv.bk.io/mg TVBOX_API_TOKEN=… TMDB_TOKEN=… \
  bun scripts/media-import-tmdb.ts [--movies 2500] [--series 2500] [--min-votes 300,150] \
    [--locales zh-CN,en-US] [--publish | --no-publish] [--dry-run] [--json report.json]
```

- Selection: `/discover/movie` and `/discover/tv`, `sort_by=vote_average.desc`, `vote_count.gte=<floor>`, `include_adult=false`, `language=zh-CN`; TV also `without_genres=10763,10767` (news, talk). Pages run from the last to the first and items within a page in reverse, so the best-rated title is posted last and is therefore first in the CMS "latest" order; the native API additionally has `sort=rating`.
- Per title one request: `/movie/{id}?language=zh-CN&append_to_response=translations,credits,images,external_ids,release_dates&include_image_language=zh,en,null` and `/tv/{id}?…append_to_response=translations,aggregate_credits,images,external_ids,content_ratings`. 8 concurrent, `Retry-After` honoured on 429; a title whose detail fails is reported and skipped.
- Batches of 50 to `POST /media/import` (about 100 calls for 5000 titles); then `POST /tvbox/publishes` unless `--no-publish`. Progress on stdout, a summary (created / updated / skipped / failed, how many titles fell back from zh-CN) at the end and in `--json`; exit code 1 when anything failed. Re-running is idempotent, which is also how an interrupted run resumes.
- v3 key or v4 read token accepted, as in `workers/home.ts`.

Mapping (TMDB → `ImportTitle`):

| Library | Source |
| --- | --- |
| `title` / `overview` / `tagline` | first non-empty in the chain `zh-CN` → `zh-TW` → `zh-HK` → `en-US` → original (`translations[]`, then the base response) |
| `translations[]` | one entry per locale in `--locales` that TMDB has (title, overview, tagline as given, no fallback) |
| `originalTitle`, `originalLanguage`, `originCountries` | `original_title` / `original_name`, `original_language`, `origin_country` or `production_countries` |
| `kind`, `categoryId` | movie → `movie`, tv → `tv`; genre 16 → `anime`, genre 99 → `documentary`, TV genre 10764 → `variety` |
| `genreIds` | `g<genre id>` (unknown ids are dropped) |
| `releaseDate`, `runtime`, `status` | `release_date` / `first_air_date`; `runtime` / `episode_run_time[0]`; TMDB `status` → `upcoming` / `released` / `returning` / `ended` / `canceled` |
| `contentRating` | US certification from `release_dates` / `content_ratings`, else the first one |
| `voteAverage`, `voteCount`, `popularity`, `isAdult` | as given |
| `collection` | `belongs_to_collection` |
| images | poster `w500` and backdrop `w1280` (`image.tmdb.org/t/p/…`) with their locale |
| external ids | `tmdb` = `movie:<id>` / `tv:<id>`; `imdb`, `tvdb` when present |
| seasons (series) | the detail's `seasons[]`: number, name, overview, air date, `episodeTotal`, poster; season 0 included; episodes are not fetched (no playable data yet; one more request per season) |
| credits | directors, writers (`Writer`, `Screenplay`, `Creator`) and the first 10 cast; profile image `w185` |
| `publishState`, `origin`, `sort` | `published`, `tmdb`, the rank within its kind |

### 4. Workflow `.github/workflows/media-import.yml`

`workflow_dispatch` only, inputs `movies`, `series`, `min_votes`, `locales`, `publish`; `timeout-minutes: 90`; env `TVBOX_URL=${{ vars.WORKER_URL }}/mg`, `TVBOX_API_TOKEN`, `TMDB_TOKEN`; uploads the `--json` report as an artifact. Same shape as `tvbox.yml`. The token needs the `media:write` scope: either a second secret `MEDIA_API_TOKEN` or the existing `TVBOX_API_TOKEN` re-issued with both scopes; the plan uses `TVBOX_API_TOKEN` and the README says to add the scope.

### 5. Tests

- `scripts/lib/tmdb.test.ts` (next to `i18n-scan.test.ts`): mapping fixtures (movie with zh-CN, movie with only en-US + zh-TW, TV with seasons and content ratings): fallback chain, translations entries, category / genre mapping, status, external id namespacing, image URLs.
- `modules/media/import/import.test.ts` (`openTestDb`): create with everything attached, re-run updates without duplicates and keeps console edits, admin-owned title skipped, people deduplicated, invalid item → 422 and nothing written, `updatedAt` untouched when nothing changed.
- `catalog.test.ts`: translations CRUD and cascade on title delete.
- `projector.test.ts` / documents: `translations` in the detail document and translated titles in the search text.
- Gates: `bun run check` (lint, typecheck, tests, build, i18n / env / api-docs drift), then `bun run test:workers`. The script itself is verified with `--dry-run` against the real TMDB and, once approved to run, against the deployment.

## Risks

- **Library size**: 5000 titles bring about 15 000 seasons, 60 000 credits and 25 000 people. Publishing loads whole tables into DO memory and diffs every read-model table (`SELECT id, hash`); expected to stay within the DO's 128 MB and the request's CPU budget, but a publish grows from seconds to tens of seconds. The caps (10 cast, no episodes, no biographies) hold this down; if a publish gets near the limit the next step is a projection in pages, not part of this plan.
- **Batch cost**: one call of 50 titles is roughly 1 500 SQLite statements inside the DO; well inside a request's budget, and the batch size is a script flag if it is not.
- **Chinese coverage**: TMDB's zh-CN overviews are missing for a share of older or niche titles; those fall back to zh-TW / English and look mixed in the app. The report counts the fallbacks so the floor or count can be tuned.
- **CMS order**: relies on write order. A later re-run that changes one title's metadata bumps only that title to the top of "latest"; acceptable for a metadata library, noted so it is not mistaken for a bug.
- **External id format**: `tmdb` external ids become `movie:<id>` / `tv:<id>`. Manually entered plain ids keep working as opaque strings but will not match the importer; the title editor's placeholder documents the new form.
- **TMDB terms**: the attribution line ("This product uses the TMDB API but is not endorsed or certified by TMDB") belongs in the app; the client is out of scope here, so it is recorded as a follow-up task for the client.

## Scope

About 22 files, all under `worker/` except the workflow:

- `apps/api/src/modules/media/`: `schema.ts`, `media.backup.ts`, `index.ts`, `contract.ts`, `catalog/translations.service.ts` (new), `catalog/catalog.routes.ts`, `catalog/titles.service.ts` (view), `readmodel/documents.ts`, `readmodel/projector.service.ts` (load translations), `import/contract.ts`, `import/import.service.ts`, `import/import.routes.ts` (new), tests.
- `apps/api/drizzle/0012_*.sql` + snapshot + `db/migrations.generated.ts`.
- `apps/web/src/app/routes/_app/admin/`: `-media-api.ts`, `-media-title-editor.tsx`; `locales/zh/media.json`, `locales/en/media.json`.
- `scripts/media-import-tmdb.ts`, `scripts/lib/tmdb.ts`, `scripts/lib/tmdb.test.ts`, `package.json` (`media:import` script).
- `.github/workflows/media-import.yml`, `README.md` (import section, token scope), `docs/reference/api-routes.md` (generated), `docs/plan/media-library.md` (deviation note on translations and external id format).

Not in scope: the RN client (including the TMDB attribution line), episodes from TMDB, person biographies, a `lang` parameter on the client-facing APIs, a scheduled refresh, playable sources (imported titles are metadata only, like the recommendation home; opening one in the app still searches the upstream sites), any import running inside the Worker.

## Alternatives

- **Background job inside the Durable Object** (first draft of this plan): self-contained and resumable, but bounded by 1000 subrequests per alarm, needs the TMDB token in the DO and a progress UI, and ties content loading to the deployment. Rejected by the user: content is loaded from outside through the API.
- **Daily export + popularity**: pick the 5000 most popular ids from the export, then fetch details. Simpler selection, but not a rating ranking. Could be a second `--source` later.
- **Per-locale read model** (one `rm_titles` row per locale, `?lang=` on the native API): full multi-language delivery, but doubles D1 rows and the publish diff for a client that cannot choose a language yet. Deferred; the translations table and the `translations` field in the detail document are the groundwork.
- **Reuse `media_title_aliases` for translations**: no overview / tagline columns and it mixes search aliases with display translations; a dedicated table is clearer.

## Annotations

- 2026-10-17 (user): translations keyed by a locale column so languages can be added later — kept (`media_title_translations.locale`). The client is out of scope. Content is not part of a deploy: it is loaded locally or from a GitHub workflow through the API — the DO job was replaced by the import route + script + workflow above.
