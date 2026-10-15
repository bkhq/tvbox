/**
 * `/s/<token>/media/home`: the app's default home, an Apple CMS JSON site
 * whose rows are public charts (docs/plan/recommend-home.md). Items carry
 * metadata only; their `vod_id` starts with `msearch:`, which the app opens
 * as a search over the upstream sites instead of a detail page.
 *
 *   (no t)   the rows as classes and the first row as the list
 *   t, pg    one row's items
 *   ids, wd  empty: nothing here has details or is searchable
 *
 * Charts are fetched on demand and kept in the Cache API for their row's TTL.
 * The last good answer of every row and page is also kept in R2 and served
 * when a source fails, so a home that loaded once never turns empty.
 */

export interface HomeBucket {
  get: (key: string) => Promise<{ text: () => Promise<string> } | null>;
  put?: (key: string, value: string) => Promise<unknown>;
}

export interface HomeEnv {
  readonly FILES?: HomeBucket | undefined;
  /** TMDB v3 API key or v4 read access token; without it the Netflix rows are skipped. */
  readonly TMDB_TOKEN?: string | undefined;
}

export interface HomeVod {
  vod_id: string;
  vod_name: string;
  vod_pic: string;
  vod_remarks: string;
  vod_year: string;
  vod_content: string;
  type_name: string;
}

interface Chart {
  list: HomeVod[];
  pagecount: number;
}

type Fetch = typeof fetch;

interface Row {
  readonly id: string;
  readonly name: string;
  /** Seconds a fetched page stays fresh. */
  readonly ttl: number;
  readonly needsTmdb?: boolean;
  readonly load: (page: number, ctx: { fetch: Fetch; tmdbKey: string }) => Promise<Chart>;
}

const HOUR = 3600;
const TIMEOUT_MS = 5000;
const DOUBAN_PAGE = 30;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const DOUBAN_PIC_REFERER = "@Referer=https://movie.douban.com/";
const TMDB_IMAGE = "https://image.tmdb.org/t/p/w500";
const FALLBACK_PREFIX = "tvbox/home/";

async function getJson<T>(f: Fetch, url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await f(url, { headers: { "user-agent": UA, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok)
    throw new Error(`${new URL(url).host} answered ${res.status}`);
  // Douban leaves raw control characters in strings.
  // eslint-disable-next-line no-control-regex
  return JSON.parse((await res.text()).replace(/[\u0000-\u001F]+/g, " ")) as T;
}

// ─── Douban ───

interface DoubanItem {
  id: string;
  title: string;
  year?: string;
  type?: string;
  card_subtitle?: string;
  episodes_info?: string;
  rating?: { value?: number } | null;
  pic?: { normal?: string; large?: string } | null;
  cover?: { url?: string } | null;
}

function doubanVod(item: DoubanItem): HomeVod {
  const pic = item.pic?.normal ?? item.pic?.large ?? item.cover?.url ?? "";
  const rating = item.rating?.value ?? 0;
  return {
    vod_id: `msearch:db:${item.id}`,
    vod_name: item.title,
    vod_pic: pic ? `${pic}${DOUBAN_PIC_REFERER}` : "",
    vod_remarks: item.episodes_info || (rating > 0 ? `${rating.toFixed(1)}分` : ""),
    vod_year: item.year ?? "",
    vod_content: item.card_subtitle ?? "",
    type_name: item.type === "tv" ? "剧集" : "电影",
  };
}

async function doubanCollection(f: Fetch, id: string, page: number): Promise<Chart> {
  const data = await getJson<{ total?: number; subject_collection_items?: DoubanItem[] }>(
    f,
    `https://m.douban.com/rexxar/api/v2/subject_collection/${id}/items?start=${(page - 1) * DOUBAN_PAGE}&count=${DOUBAN_PAGE}`,
    { referer: "https://m.douban.com/" },
  );
  const list = (data.subject_collection_items ?? []).filter(i => i.id && i.title).map(doubanVod);
  return { list, pagecount: Math.max(1, Math.ceil((data.total ?? list.length) / DOUBAN_PAGE)) };
}

function douban(id: string, ttl: number, name: string, collection: string): Row {
  return { id, name, ttl, load: (page, { fetch }) => doubanCollection(fetch, collection, page) };
}

// ─── iQiyi ───

interface IqiyiRankItem {
  id?: string;
  aid?: string;
  title: string;
  img?: string;
  desc?: string;
  tags?: string;
  tuijian?: string;
}

/** 风云榜 of one channel (1 movies, 2 series, 4 anime, 6 variety), ranked by rise. */
function iqiyiRank(id: string, name: string, channel: number, typeName: string): Row {
  return {
    id,
    name,
    ttl: HOUR,
    load: async (page, { fetch }) => {
      const data = await getJson<{ data?: { formatData?: { data?: { content?: IqiyiRankItem[] } } } }>(
        fetch,
        `https://pcw-api.iqiyi.com/strategy/pcw/data/topRanksData?page_st=-1&tag=0&category_id=${channel}&date=&pg_num=${page}&pg_size=25`,
      );
      const list = (data.data?.formatData?.data?.content ?? []).filter(i => i.title).map((i): HomeVod => {
        // "电视剧 / 2026 / 悬疑 犯罪 / 陈哲远 蒋欣"
        const tags = (i.tags ?? "").split(" / ");
        return {
          vod_id: `msearch:iq:${i.aid ?? i.id ?? i.title}`,
          vod_name: i.title,
          vod_pic: i.img ?? "",
          vod_remarks: i.tuijian ?? "",
          vod_year: tags.find(t => /^\d{4}$/.test(t)) ?? "",
          vod_content: i.desc ?? "",
          type_name: typeName,
        };
      });
      // The chart is a few pages deep; an empty page is its end.
      return { list, pagecount: list.length > 0 ? page + 1 : page };
    },
  };
}

// ─── Netflix (weekly Top 10, named through TMDB) ───

const NETFLIX_TSV = "https://www.netflix.com/tudum/top10/data/all-weeks-global.tsv";

interface NetflixEntry {
  title: string;
  season: string;
}

/** The newest week's entries of the categories starting with `prefix` ("Films", "TV"), by rank, English first. */
export function parseNetflixTop10(tsv: string, prefix: string): NetflixEntry[] {
  const rows = tsv.split("\n").slice(1).map(line => line.split("\t")).filter(c => c.length >= 5);
  const week = rows.reduce((max, c) => (c[0]! > max ? c[0]! : max), "");
  return rows
    .filter(c => c[0] === week && c[1]!.startsWith(prefix))
    .sort((a, b) => Number(a[2]) - Number(b[2]) || a[1]!.localeCompare(b[1]!))
    .map(c => ({ title: c[3]!, season: c[4] === "N/A" ? "" : c[4]! }));
}

interface TmdbResult {
  id: number;
  title?: string;
  name?: string;
  poster_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  overview?: string;
}

function tmdbHeaders(key: string): { url: string; headers: Record<string, string> } {
  // A v4 read access token is a JWT; a v3 key goes in the query.
  return key.startsWith("eyJ")
    ? { url: "", headers: { authorization: `Bearer ${key}` } }
    : { url: `&api_key=${encodeURIComponent(key)}`, headers: {} };
}

async function tmdbFind(f: Fetch, key: string, kind: "movie" | "tv", query: string): Promise<TmdbResult | undefined> {
  const auth = tmdbHeaders(key);
  const data = await getJson<{ results?: TmdbResult[] }>(
    f,
    `https://api.themoviedb.org/3/search/${kind}?language=zh-CN&query=${encodeURIComponent(query)}${auth.url}`,
    auth.headers,
  );
  return data.results?.[0];
}

function seasonLabel(season: string): string {
  const n = /Season (\d+)/.exec(season)?.[1];
  if (n)
    return `第${n}季`;
  return season.endsWith("Limited Series") ? "迷你剧" : "";
}

function netflix(id: string, name: string, prefix: "Films" | "TV"): Row {
  const kind = prefix === "TV" ? "tv" : "movie";
  return {
    id,
    name,
    ttl: 12 * HOUR,
    needsTmdb: true,
    load: async (page, { fetch, tmdbKey }) => {
      if (page > 1)
        return { list: [], pagecount: 1 };
      const res = await fetch(NETFLIX_TSV, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok)
        throw new Error(`netflix answered ${res.status}`);
      const entries = parseNetflixTop10(await res.text(), prefix);
      const found = await Promise.all(entries.map(async e => ({ e, r: await tmdbFind(fetch, tmdbKey, kind, e.title).catch(() => undefined) })));
      const seen = new Set<number>();
      const list: HomeVod[] = [];
      for (const { e, r } of found) {
        if (!r || seen.has(r.id))
          continue;
        seen.add(r.id);
        const vote = r.vote_average ?? 0;
        list.push({
          vod_id: `msearch:tmdb:${kind}:${r.id}`,
          vod_name: r.title ?? r.name ?? e.title,
          vod_pic: r.poster_path ? `${TMDB_IMAGE}${r.poster_path}` : "",
          vod_remarks: seasonLabel(e.season) || (vote > 0 ? `${vote.toFixed(1)}分` : ""),
          vod_year: (r.release_date ?? r.first_air_date ?? "").slice(0, 4),
          vod_content: r.overview ?? "",
          type_name: kind === "tv" ? "剧集" : "电影",
        });
      }
      return { list, pagecount: 1 };
    },
  };
}

// ─── Rows ───

const realtime: Row = {
  id: "hot",
  name: "实时热门",
  ttl: HOUR,
  load: async (page, { fetch }) => {
    if (page > 1)
      return { list: [], pagecount: 1 };
    const [movies, series] = await Promise.all([
      doubanCollection(fetch, "movie_real_time_hotest", 1),
      doubanCollection(fetch, "tv_real_time_hotest", 1),
    ]);
    const list: HomeVod[] = [];
    for (let i = 0; i < Math.max(movies.list.length, series.list.length); i++)
      list.push(...[series.list[i], movies.list[i]].filter((v): v is HomeVod => v !== undefined));
    return { list, pagecount: 1 };
  },
};

export const ROWS: readonly Row[] = [
  realtime,
  iqiyiRank("iqiyi_tv", "爱奇艺热播剧", 2, "剧集"),
  netflix("netflix_tv", "Netflix 剧集", "TV"),
  netflix("netflix_movie", "Netflix 电影", "Films"),
  douban("movie", 6 * HOUR, "热门电影", "movie_hot_gaia"),
  douban("tv", 6 * HOUR, "热门剧集", "tv_hot"),
  douban("show", 6 * HOUR, "热门综艺", "show_hot"),
  douban("anime", 6 * HOUR, "热门动画", "tv_animation"),
  douban("top250", 24 * HOUR, "豆瓣 Top 250", "movie_top250"),
];

// ─── Serving ───

interface CacheLike {
  match: (key: string) => Promise<Response | undefined>;
  put: (key: string, response: Response) => Promise<void>;
}

function sharedCache(): CacheLike | undefined {
  return (globalThis as { caches?: { default?: CacheLike } }).caches?.default;
}

export interface HomeOptions {
  readonly fetch?: Fetch;
  readonly cache?: CacheLike;
}

/** A row's page: from the cache, else the source, else the last good copy in R2. */
async function chart(row: Row, page: number, env: HomeEnv, origin: string, opts: HomeOptions): Promise<Chart> {
  const cache = opts.cache ?? sharedCache();
  const cacheKey = `${origin}/__home/${row.id}/${page}`;
  const hit = await cache?.match(cacheKey);
  if (hit)
    return await hit.json() as Chart;

  const fallbackKey = `${FALLBACK_PREFIX}${row.id}-${page}.json`;
  try {
    const fresh = await row.load(page, { fetch: opts.fetch ?? fetch, tmdbKey: env.TMDB_TOKEN ?? "" });
    if (fresh.list.length === 0 && page === 1)
      throw new Error("empty chart");
    const body = JSON.stringify(fresh);
    await Promise.all([
      cache?.put(cacheKey, new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${row.ttl}` } })),
      fresh.list.length > 0 ? env.FILES?.put?.(fallbackKey, body) : undefined,
    ]);
    return fresh;
  }
  catch {
    const stale = await env.FILES?.get(fallbackKey).catch(() => null);
    return stale ? JSON.parse(await stale.text()) as Chart : { list: [], pagecount: 1 };
  }
}

function body(list: HomeVod[], page: number, pagecount: number, extra = ""): string {
  return `{"code":1,"msg":"数据列表","page":${page},"pagecount":${pagecount},"limit":${list.length},"total":${list.length},"list":${JSON.stringify(list)}${extra}}`;
}

function json(text: string, maxAge: number): Response {
  return new Response(text, {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": `private, max-age=${maxAge}` },
  });
}

export async function handleHome(request: Request, env: HomeEnv, opts: HomeOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const params = url.searchParams;
  const rows = ROWS.filter(r => !r.needsTmdb || env.TMDB_TOKEN);

  if (params.has("ids") || params.has("wd"))
    return json(body([], 1, 1), HOUR);

  const t = params.get("t");
  if (t) {
    const row = rows.find(r => r.id === t);
    if (!row)
      return json(body([], 1, 1), HOUR);
    const pg = Number(params.get("pg") ?? 1);
    const page = Number.isSafeInteger(pg) && pg >= 1 && pg <= 100 ? pg : 1;
    const { list, pagecount } = await chart(row, page, env, url.origin, opts);
    return json(body(list, page, pagecount), 300);
  }

  const first = await chart(rows[0]!, 1, env, url.origin, opts);
  const classes = rows.map(r => ({ type_id: r.id, type_name: r.name }));
  return json(body(first.list, 1, 1, `,"class":${JSON.stringify(classes)}`), 300);
}
