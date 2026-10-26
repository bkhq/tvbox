import type { SQL } from "drizzle-orm";
import type { TitleFilter, View } from "./query";
import type { CmsItemDoc, Vod } from "@/modules/media/serve/cms";
import { sql } from "drizzle-orm";
import { buildCmsItems } from "@/modules/media/serve/cms";
import { buildTitles } from "@/modules/media/serve/documents";
import { loadSlice } from "@/modules/media/serve/slice";
import { facets, filterSql, manifest, rows, rowTitleIds, searchTitleIds } from "./query";

/**
 * `/m/<token>/cms`: the library as an Apple CMS v10 JSON site
 * (docs/plan/media-library.md, part 4), for clients that only speak CMS.
 * One item per playable movie and per playable season (serve/cms.ts),
 * selected in SQL and built from a slice of the page's titles.
 *
 *   (no ac, t, ids or wd)   classes, filters and the first home row
 *   t, pg, f                a category's items, newest first, 20 a page
 *   ids                     details with play lists
 *   wd, pg                  search; every season of a matching series
 */

const PAGE = 20;
const MAX_IDS = 50;

const FILTER_NAMES = { genre: "类型", year: "年份", country: "地区" } as const;
type FilterKey = keyof typeof FILTER_NAMES;

function body(list: Vod[], page: number, pagecount: number, total: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    code: 1,
    msg: "数据列表",
    page,
    pagecount,
    limit: PAGE,
    total,
    list,
    ...extra,
  });
}

function pageOf(value: string | null): number {
  const n = Number(value ?? 1);
  return Number.isSafeInteger(n) && n >= 1 && n <= 10_000
    ? n
    : 1;
}

/** The CMS items of `titleIds`, every playable movie and season. */
async function items(view: View, titleIds: readonly string[]): Promise<CmsItemDoc[]> {
  if (titleIds.length === 0)
    return [];
  const slice = await loadSlice(view.db, view, titleIds, { credits: true });
  const built = buildTitles(slice, view.today);
  return buildCmsItems(
    built.titles,
    built.seasons,
    built.playback,
    new Map(slice.categories.map(c => [c.id, c.name])),
    new Map(slice.genres.map(g => [g.id, g.name])),
  );
}

// Playable items of live titles: a movie with a stream on an enabled line, a
// published season with an aired published episode streamed on one of its
// enabled lines.
function playable(where: SQL, today: string): SQL {
  return sql`SELECT t.id AS title_id, t.id AS vod_id, t.updated_at AS u FROM media_titles t
      WHERE ${where} AND t.kind = 'movie' AND (t.release_date IS NULL OR t.release_date <= ${today})
        AND EXISTS (SELECT 1 FROM media_sources so JOIN media_streams st ON st.source_id = so.id
          WHERE so.title_id = t.id AND so.enabled = 1 AND st.episode_id IS NULL)
    UNION ALL
    SELECT t.id, s.id, t.updated_at FROM media_titles t JOIN media_seasons s ON s.title_id = t.id
      WHERE ${where} AND t.kind = 'series' AND s.publish_state = 'published'
        AND EXISTS (SELECT 1 FROM media_episodes e JOIN media_streams st ON st.episode_id = e.id JOIN media_sources so ON so.id = st.source_id
          WHERE e.season_id = s.id AND so.season_id = s.id AND so.enabled = 1 AND (e.air_date IS NULL OR e.air_date <= ${today})
            AND e.publish_state = 'published')`;
}

async function home(view: View): Promise<string> {
  const categories = (await manifest(view)).categories.filter(c => c.count > 0);
  const classes = categories.map(c => ({ type_id: c.id, type_name: c.name }));
  const filters: Record<string, unknown[]> = {};
  for (const c of categories) {
    const values = await facets(view, { category: c.id });
    filters[c.id] = c.filters
      .filter(key => (values[key]?.length ?? 0) > 0)
      .map(key => ({
        key,
        name: FILTER_NAMES[key],
        init: "",
        value: [
          { n: "全部", v: "" },
          ...values[key]!.map(v => ({ n: v.label, v: v.value })),
        ],
      }));
  }

  // The first home row, each series as its newest season.
  const first = (await rows(view.db)).find(r => r.onHome);
  let list: Vod[];
  const titleIds = first
    ? await rowTitleIds(view, first, 0, PAGE)
    : [];
  if (titleIds.length > 0) {
    const newest = new Map<string, CmsItemDoc>();
    for (const item of await items(view, titleIds)) {
      if ((newest.get(item.titleId)?.groupOrder ?? -1) < item.groupOrder)
        newest.set(item.titleId, item);
    }
    list = titleIds.flatMap(id => (newest.has(id)
      ? [newest.get(id)!.list]
      : []));
  }
  else {
    list = (await page(view, {}, 0)).list;
  }
  return body(list, 1, 1, list.length, { class: classes, filters });
}

/** A page of playable items matching `filter`, newest first. */
async function page(view: View, filter: TitleFilter, offset: number): Promise<{ list: Vod[]; total: number }> {
  const { db } = view;
  const query = playable(sql.join(filterSql(view.channels, filter), sql` AND `), view.today);
  const [[count], refs] = await Promise.all([
    db.all<{ n: number }>(sql`SELECT COUNT(*) AS n FROM (${query})`),
    db.all<{ title_id: string; vod_id: string }>(sql`${query} ORDER BY u DESC, vod_id DESC LIMIT ${PAGE} OFFSET ${offset}`),
  ]);
  const byId = new Map((await items(view, refs.map(r => r.title_id))).map(i => [i.vodId, i.list]));
  return {
    list: refs.flatMap(r => (byId.has(r.vod_id)
      ? [
          byId.get(r.vod_id)!,
        ]
      : [])),
    total: count?.n ?? 0,
  };
}

function parseFilters(f: string | null): TitleFilter {
  if (!f)
    return {};
  try {
    const raw = JSON.parse(f) as Record<string, unknown>;
    const value = (key: FilterKey) => (typeof raw[key] === "string" && raw[key] !== ""
      ? raw[key]
      : undefined);
    const year = Number(value("year"));
    return {
      genre: value("genre"),
      country: value("country"),
      year: Number.isSafeInteger(year) && year > 0
        ? year
        : undefined,
    };
  }
  catch {
    return {};
  }
}

async function category(view: View, typeId: string, n: number, f: string | null): Promise<string> {
  const { list, total } = await page(view, {
    ...parseFilters(f),
    category: typeId,
  }, (n - 1) * PAGE);
  return body(list, n, Math.max(1, Math.ceil(total / PAGE)), total);
}

async function detail(view: View, ids: string): Promise<string> {
  const wanted = [
    ...new Set(ids.split(",").map(s => s.trim()).filter(Boolean)),
  ].slice(0, MAX_IDS);
  if (wanted.length === 0)
    return body([], 1, 1, 0);
  const owners = await view.db.all<{ id: string }>(sql`SELECT id FROM media_titles WHERE id IN ${wanted}
    UNION SELECT title_id FROM media_seasons WHERE id IN ${wanted}`);
  const byId = new Map((await items(view, owners.map(o => o.id))).map(i => [i.vodId, i.detail]));
  const list = wanted.flatMap(id => (byId.has(id)
    ? [
        byId.get(id)!,
      ]
    : []));
  return body(list, 1, 1, list.length);
}

async function search(view: View, wd: string, n: number): Promise<string> {
  const q = wd.trim().slice(0, 50);
  if (!q)
    return body([], 1, 1, 0);
  // Pages are pages of titles; a series brings all its seasons along.
  const found = await searchTitleIds(view, q, (n - 1) * PAGE, PAGE + 1);
  const more = found.length > PAGE;
  const titleIds = found.slice(0, PAGE);
  const rank = new Map(titleIds.map((id, i) => [id, i]));
  const list = (await items(view, titleIds))
    .sort((a, b) => rank.get(a.titleId)! - rank.get(b.titleId)! || a.groupOrder - b.groupOrder)
    .map(i => i.list);
  return body(list, n, more
    ? n + 1
    : n, (n - 1) * PAGE + list.length);
}

export async function handleCms(view: View, params: URLSearchParams): Promise<Response> {
  const n = pageOf(params.get("pg"));
  let text: string;
  if (params.get("ids"))
    text = await detail(view, params.get("ids")!);
  else if (params.get("wd"))
    text = await search(view, params.get("wd")!, n);
  else if (params.get("t"))
    text = await category(view, params.get("t")!, n, params.get("f"));
  else
    text = await home(view);
  return new Response(text, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
