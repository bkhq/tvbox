# Plan: recommendation home built by the worker

Status: implemented (2026-10-15), not yet deployed; emulator check pending.

## Goal

The app's default home stops being one upstream site's `homeContent`. The
worker serves its own home: rows of popular titles from public charts
(Douban, iQiyi, Netflix), metadata only. Opening a title searches every
upstream site for it, and the user plays it from whichever site has it.

Every upstream site (all 107 in xiaosa) is a `type 3` spider that only runs
inside the app, so the worker cannot read upstream content itself.

## Sources (checked 2026-10-15)

| Row | Source | Refresh |
| --- | --- | --- |
| 实时热门 | Douban `movie_real_time_hotest` + `tv_real_time_hotest`, interleaved | 1 h |
| 爱奇艺热播剧 | iQiyi 风云榜, `topRanksData?category_id=2` | 1 h |
| Netflix 剧集 / 电影 | Netflix global weekly Top 10 TSV, named through TMDB search (`zh-CN`) | 12 h |
| 热门电影 / 剧集 / 综艺 / 动画 | Douban `movie_hot_gaia`, `tv_hot`, `show_hot`, `tv_animation` | 6 h |
| 豆瓣 Top 250 | Douban `movie_top250` | 24 h |

- Douban: `m.douban.com/rexxar/api/v2/subject_collection/<id>/items` with a
  `m.douban.com` referer. Posters need `Referer: https://movie.douban.com/`,
  passed as the TVBox `pic@Referer=` suffix the app already splits. Douban's
  search endpoint is rate limited (403 `need_login` after ~10 calls), so it is
  not used.
- iQiyi: no auth; posters have no referer check.
- Netflix: the TSV has English titles only and needs a Safari user agent;
  TMDB maps them to Chinese names and posters. Without `TMDB_TOKEN` the
  Netflix rows are left out.
- Tencent Video and Youku: no usable public endpoint found; not included.

## Worker

`apps/api/src/workers/home.ts`, served at `/s/<token>/media/home` by the
stateless Worker (no D1, no Durable Object):

| Query | Answer |
| --- | --- |
| none | `class`: one entry per row; `list`: the first row |
| `t`, `pg` | that row's items (Douban 30 a page; iQiyi pages until empty; Netflix one page) |
| `ids`, `wd` | empty list |

Items: `vod_id` = `msearch:<db|iq|tmdb:<kind>>:<id>`, name, poster, remarks
(episode note, iQiyi heat, season or rating), year, content.

Each page is kept in the Cache API for its row's refresh time; the last good
copy is written to R2 (`tvbox/home/<row>-<page>.json`) and served when a
source fails or times out (5 s).

`subscription.ts` puts `HOME_SITE` (`bk_home`, type 1, `@media/home`,
not searchable) first in every served config, so the app opens it until the
user picks another site.

Secret `TMDB_TOKEN` (v3 key, or v4 token starting with `eyJ`) ships with the
deploy workflow like the other secrets.

## App (client/)

- `openVod`: a `msearch:` vod navigates to `Search { keyword: vod_name }`
  (home rows, category grids, section tabs, search results).
- Hero: a chart entry shows one 搜索片源 button instead of play / keep /
  detail, so no history or favourite points at an id with no detail page.
- `createSiteHomeContent` for `bk_home`: one row per class (the home list is
  the first; the rest load page 1 in parallel; failed or empty rows dropped).

## Remaining

- Deploy (the `TMDB_TOKEN` repository secret exists) and confirm Douban,
  iQiyi and Netflix answer from the Cloudflare edge. If Douban blocks the
  edge, move the fetch to the "TVBox sources" workflow and upload to R2.
- Release x86 build on the emulator: rows render, a title opens the search.

## Out of scope

Admin UI for rows, automatic matching of a title to one site result,
mirroring posters to R2.
