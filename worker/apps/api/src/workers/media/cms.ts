import type { ReadModelDb } from "@/modules/media/readmodel/store";
import { meta, searchRefs } from "./query";

/**
 * `/media/cms`: the library as an Apple CMS v10 JSON site
 * (docs/plan/media-library.md, part 4), for clients that only speak CMS.
 * Items and their `vod` fields are built when publishing (readmodel/cms.ts);
 * this only selects and pages them.
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

interface FacetValue {
  value: string;
  label: string;
}

function body(list: string[], page: number, pagecount: number, total: number, extra = ""): string {
  return `{"code":1,"msg":"数据列表","page":${page},"pagecount":${pagecount},"limit":${PAGE},"total":${total},"list":[${list.join(",")}]${extra}}`;
}

function pageOf(value: string | null): number {
  const n = Number(value ?? 1);
  return Number.isSafeInteger(n) && n >= 1 && n <= 10_000 ? n : 1;
}

async function home(rm: ReadModelDb): Promise<string> {
  const manifest = await meta<{ categories: { id: string; name: string; filters: FilterKey[]; count: number }[] }>(rm, "manifest");
  const categories = (manifest?.categories ?? []).filter(c => c.count > 0);
  const classes = categories.map(c => ({ type_id: c.id, type_name: c.name }));
  const filters: Record<string, unknown[]> = {};
  for (const c of categories) {
    const facets = await meta<Partial<Record<FilterKey, FacetValue[]>>>(rm, `facets:${c.id}`);
    filters[c.id] = c.filters
      .filter(key => (facets?.[key]?.length ?? 0) > 0)
      .map(key => ({
        key,
        name: FILTER_NAMES[key],
        init: "",
        value: [{ n: "全部", v: "" }, ...facets![key]!.map(v => ({ n: v.label, v: v.value }))],
      }));
  }

  // The first home row, each series as its newest season.
  const homeDoc = await meta<{ rows: { items: { id: string }[] }[] }>(rm, "home");
  const titleIds = (homeDoc?.rows[0]?.items ?? []).map(i => i.id).slice(0, PAGE);
  let list: string[];
  if (titleIds.length > 0) {
    const { results } = await rm.prepare(`SELECT title_id, list_json FROM rm_cms_items WHERE title_id IN (${titleIds.map(() => "?").join(", ")}) ORDER BY group_order DESC`)
      .bind(...titleIds)
      .all<{ title_id: string; list_json: string }>();
    const newest = new Map<string, string>();
    for (const r of results) {
      if (!newest.has(r.title_id))
        newest.set(r.title_id, r.list_json);
    }
    list = titleIds.map(id => newest.get(id)).filter((v): v is string => v !== undefined);
  }
  else {
    list = (await rm.prepare("SELECT list_json FROM rm_cms_items ORDER BY updated_at DESC, vod_id LIMIT ?").bind(PAGE).all<{ list_json: string }>()).results.map(r => r.list_json);
  }
  return body(list, 1, 1, list.length, `,"class":${JSON.stringify(classes)},"filters":${JSON.stringify(filters)}`);
}

function parseFilters(f: string | null): Partial<Record<FilterKey, string>> {
  if (!f)
    return {};
  try {
    const raw = JSON.parse(f) as Record<string, unknown>;
    const out: Partial<Record<FilterKey, string>> = {};
    for (const key of Object.keys(FILTER_NAMES) as FilterKey[]) {
      if (typeof raw[key] === "string" && raw[key] !== "")
        out[key] = raw[key];
    }
    return out;
  }
  catch {
    return {};
  }
}

async function category(rm: ReadModelDb, typeId: string, page: number, f: string | null): Promise<string> {
  const filters = parseFilters(f);
  const where = ["type_id = ?"];
  const params: unknown[] = [typeId];
  if (filters.year) {
    where.push("year = ?");
    params.push(Number(filters.year));
  }
  if (filters.country) {
    where.push("country = ?");
    params.push(filters.country);
  }
  if (filters.genre) {
    where.push("genres LIKE ?");
    params.push(`%,${filters.genre.replace(/[%_,]/g, "")},%`);
  }
  const sql = where.join(" AND ");
  const total = (await rm.prepare(`SELECT COUNT(*) AS n FROM rm_cms_items WHERE ${sql}`).bind(...params).first<{ n: number }>())?.n ?? 0;
  const { results } = await rm.prepare(`SELECT list_json FROM rm_cms_items WHERE ${sql} ORDER BY updated_at DESC, vod_id LIMIT ? OFFSET ?`)
    .bind(...params, PAGE, (page - 1) * PAGE)
    .all<{ list_json: string }>();
  return body(results.map(r => r.list_json), page, Math.max(1, Math.ceil(total / PAGE)), total);
}

async function detail(rm: ReadModelDb, ids: string): Promise<string> {
  const wanted = [...new Set(ids.split(",").map(s => s.trim()).filter(Boolean))].slice(0, MAX_IDS);
  if (wanted.length === 0)
    return body([], 1, 1, 0);
  const { results } = await rm.prepare(`SELECT vod_id, detail_json FROM rm_cms_items WHERE vod_id IN (${wanted.map(() => "?").join(", ")})`)
    .bind(...wanted)
    .all<{ vod_id: string; detail_json: string }>();
  const byId = new Map(results.map(r => [r.vod_id, r.detail_json]));
  const list = wanted.map(id => byId.get(id)).filter((v): v is string => v !== undefined);
  return body(list, 1, 1, list.length);
}

async function search(rm: ReadModelDb, wd: string, page: number): Promise<string> {
  const q = wd.trim().slice(0, 50);
  if (!q)
    return body([], 1, 1, 0);
  // Pages are pages of titles; a series brings all its seasons along.
  const refs = await searchRefs(rm, q, (page - 1) * PAGE, PAGE + 1, "title");
  const more = refs.length > PAGE;
  const titleIds = refs.slice(0, PAGE).map(r => r.ref);
  let list: string[] = [];
  if (titleIds.length > 0) {
    const { results } = await rm.prepare(`SELECT title_id, list_json FROM rm_cms_items WHERE title_id IN (${titleIds.map(() => "?").join(", ")}) ORDER BY group_order`)
      .bind(...titleIds)
      .all<{ title_id: string; list_json: string }>();
    const rank = new Map(titleIds.map((id, i) => [id, i]));
    list = results.sort((a, b) => rank.get(a.title_id)! - rank.get(b.title_id)!).map(r => r.list_json);
  }
  return body(list, page, more ? page + 1 : page, (page - 1) * PAGE + list.length);
}

export async function handleCms(rm: ReadModelDb, params: URLSearchParams): Promise<Response> {
  const page = pageOf(params.get("pg"));
  let text: string;
  if (params.get("ids"))
    text = await detail(rm, params.get("ids")!);
  else if (params.get("wd"))
    text = await search(rm, params.get("wd")!, page);
  else if (params.get("t"))
    text = await category(rm, params.get("t")!, page, params.get("f"));
  else
    text = await home(rm);
  return new Response(text, { headers: { "content-type": "application/json; charset=utf-8" } });
}
