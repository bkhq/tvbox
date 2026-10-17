/**
 * TMDB → the media library's import documents (apps/api/.../import/contract.ts).
 *
 * Pure: `mapMovie` / `mapTv` turn one detail response (fetched with
 * `append_to_response`, see `DETAIL_APPEND`) into an `ImportTitle`, and
 * `rankedIds` walks `/discover` pages in the order the titles should be
 * written. The HTTP client takes `fetch` so tests pass a fake.
 */
import type { ImportTitle } from "../../apps/api/src/modules/media/import/contract";

export type Kind = "movie" | "tv";

/** Where a display field came from: a locale from the fallback chain, the original, or nothing. */
export type Resolved = string | "original" | null;

export interface MapOptions {
  /** Locales stored as translations when TMDB has them. */
  readonly locales: readonly string[];
  /** Locales tried in order for the display title / overview / tagline, before the original. */
  readonly fallback: readonly string[];
  /** Cast members kept, in billing order. */
  readonly cast: number;
  /** The title's rank in its list; becomes `sort`. */
  readonly rank: number;
}

export const DEFAULT_FALLBACK = ["zh-CN", "zh-TW", "zh-HK", "en-US"] as const;
export const DEFAULT_LOCALES = ["zh-CN", "en-US"] as const;

export const DETAIL_APPEND: Record<Kind, string> = {
  movie: "translations,credits,images,external_ids,release_dates",
  tv: "translations,aggregate_credits,images,external_ids,content_ratings",
};

const IMAGE = "https://image.tmdb.org/t/p";
const WRITER_JOBS = new Set(["Writer", "Screenplay", "Creator"]);
const ANIMATION = 16;
const DOCUMENTARY = 99;
const VARIETY = new Set([10764, 10767]);

// ─── TMDB shapes (the fields used) ───

interface Translation {
  iso_639_1: string;
  iso_3166_1: string;
  data: { title?: string; name?: string; overview?: string; tagline?: string };
}

interface Image { file_path: string; iso_639_1: string | null; width: number; height: number }

interface Person { id: number; name: string; original_name?: string; profile_path: string | null }

interface Common {
  id: number;
  original_language: string;
  overview: string;
  tagline?: string;
  adult: boolean;
  vote_average: number;
  vote_count: number;
  popularity: number;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: { id: number; name: string }[];
  translations: { translations: Translation[] };
  images: { posters: Image[]; backdrops: Image[] };
  external_ids: { imdb_id?: string | null; tvdb_id?: number | null };
}

export interface TmdbMovie extends Common {
  title: string;
  original_title: string;
  release_date: string;
  runtime: number | null;
  status: string;
  production_countries: { iso_3166_1: string }[];
  origin_country?: string[];
  belongs_to_collection: { id: number; name: string } | null;
  credits: {
    cast: (Person & { character: string; order: number })[];
    crew: (Person & { department: string; job: string })[];
  };
  release_dates: { results: { iso_3166_1: string; release_dates: { certification: string }[] }[] };
}

export interface TmdbTv extends Common {
  name: string;
  original_name: string;
  first_air_date: string | null;
  episode_run_time: number[];
  status: string;
  origin_country: string[];
  created_by: Person[];
  seasons: { season_number: number; name: string; overview: string; air_date: string | null; episode_count: number; poster_path: string | null }[];
  aggregate_credits: {
    cast: (Person & { roles: { character: string }[]; order: number })[];
    crew: (Person & { department: string; jobs: { job: string }[] })[];
  };
  content_ratings: { results: { iso_3166_1: string; rating: string }[] };
}

export interface Mapped {
  readonly title: ImportTitle;
  /** Which locale supplied the display title and overview (for the run's report). */
  readonly resolved: { title: Resolved; overview: Resolved };
}

// ─── Mapping ───

const text = (s: string | null | undefined): string | null => (s && s.trim() ? s.trim() : null);
const localeOf = (t: Translation) => `${t.iso_639_1}-${t.iso_3166_1}`;
const img = (size: string, path: string | null | undefined) => (path ? `${IMAGE}/${size}${path}` : null);

function pick(translations: Translation[], chain: readonly string[], field: (t: Translation) => string | null | undefined): { value: string; locale: string } | null {
  for (const locale of chain) {
    const t = translations.find(x => localeOf(x) === locale);
    const v = text(t ? field(t) : null);
    if (v)
      return { value: v, locale };
  }
  return null;
}

function translationsOf(translations: Translation[], locales: readonly string[], titleOf: (t: Translation) => string | undefined): NonNullable<ImportTitle["translations"]> {
  const out: NonNullable<ImportTitle["translations"]> = [];
  for (const locale of locales) {
    const t = translations.find(x => localeOf(x) === locale);
    if (!t)
      continue;
    const entry = { locale, title: text(titleOf(t)), overview: text(t.data.overview), tagline: text(t.data.tagline) };
    if (entry.title || entry.overview || entry.tagline)
      out.push(entry);
  }
  return out;
}

function imagesOf(c: Common): NonNullable<ImportTitle["images"]> {
  const out: NonNullable<ImportTitle["images"]> = [];
  const add = (kind: "poster" | "backdrop", path: string | null, size: string, pool: Image[]) => {
    if (!path)
      return;
    const meta = pool.find(i => i.file_path === path);
    out.push({ kind, url: `${IMAGE}/${size}${path}`, locale: meta?.iso_639_1 ?? null, width: meta?.width ?? null, height: meta?.height ?? null });
  };
  add("poster", c.poster_path, "w500", c.images?.posters ?? []);
  add("backdrop", c.backdrop_path, "w1280", c.images?.backdrops ?? []);
  return out;
}

function person(p: Person): NonNullable<ImportTitle["credits"]>[number]["person"] {
  return { externalId: String(p.id), name: p.name, originalName: text(p.original_name) === p.name ? null : text(p.original_name), profile: img("w185", p.profile_path) };
}

function categoryOf(kind: Kind, genreIds: number[]): string {
  if (genreIds.includes(ANIMATION))
    return "anime";
  if (genreIds.includes(DOCUMENTARY))
    return "documentary";
  if (kind === "tv" && genreIds.some(g => VARIETY.has(g)))
    return "variety";
  return kind === "movie" ? "movie" : "tv";
}

function externalIds(kind: Kind, c: Common): ImportTitle["externalIds"] {
  return {
    tmdb: `${kind}:${c.id}`,
    ...(c.external_ids?.imdb_id ? { imdb: c.external_ids.imdb_id } : {}),
    ...(c.external_ids?.tvdb_id ? { tvdb: String(c.external_ids.tvdb_id) } : {}),
  };
}

function base(kind: Kind, c: Common, original: string, titleOf: (t: Translation) => string | undefined, opts: MapOptions) {
  const translations = c.translations?.translations ?? [];
  const title = pick(translations, opts.fallback, titleOf);
  const overview = pick(translations, opts.fallback, t => t.data.overview) ?? (text(c.overview) ? { value: c.overview.trim(), locale: "original" } : null);
  const tagline = pick(translations, opts.fallback, t => t.data.tagline);
  const genreIds = (c.genres ?? []).map(g => g.id);
  return {
    resolved: { title: title ? title.locale : "original", overview: overview ? overview.locale : null } as Mapped["resolved"],
    fields: {
      externalIds: externalIds(kind, c),
      categoryId: categoryOf(kind, genreIds),
      title: title?.value ?? original,
      originalTitle: original,
      originalLanguage: c.original_language || null,
      overview: overview?.value ?? null,
      tagline: tagline?.value ?? text(c.tagline),
      isAdult: c.adult,
      voteAverage: c.vote_average,
      voteCount: c.vote_count,
      popularity: c.popularity,
      publishState: "published" as const,
      origin: "tmdb" as const,
      sort: opts.rank,
      genreIds: genreIds.map(id => `g${id}`),
      translations: translationsOf(translations, opts.locales, titleOf),
      images: imagesOf(c),
    },
  };
}

function movieStatus(s: string): NonNullable<ImportTitle["status"]> {
  return s === "Released" ? "released" : s === "Canceled" ? "canceled" : "upcoming";
}

function tvStatus(s: string, firstAir: string | null): NonNullable<ImportTitle["status"]> {
  if (s === "Ended")
    return "ended";
  if (s === "Canceled")
    return "canceled";
  return firstAir ? "returning" : "upcoming";
}

function certification(results: { iso_3166_1: string; certs: string[] }[]): string | null {
  const us = results.find(r => r.iso_3166_1 === "US")?.certs.find(Boolean);
  return us ?? results.flatMap(r => r.certs).find(Boolean) ?? null;
}

export function mapMovie(m: TmdbMovie, opts: MapOptions): Mapped {
  const { resolved, fields } = base("movie", m, m.original_title, t => t.data.title, opts);
  const countries = m.origin_country?.length ? m.origin_country : (m.production_countries ?? []).map(c => c.iso_3166_1);
  const crew = m.credits?.crew ?? [];
  const credits: NonNullable<ImportTitle["credits"]> = [
    ...crew.filter(c => c.job === "Director").map(c => ({ person: person(c), role: "crew" as const, department: c.department, job: c.job })),
    ...crew.filter(c => WRITER_JOBS.has(c.job)).map(c => ({ person: person(c), role: "crew" as const, department: c.department, job: c.job })),
    ...[...(m.credits?.cast ?? [])].sort((a, b) => a.order - b.order).slice(0, opts.cast).map(c => ({ person: person(c), role: "cast" as const, character: text(c.character) })),
  ];
  return {
    resolved,
    title: {
      kind: "movie",
      ...fields,
      originCountries: countries,
      releaseDate: text(m.release_date),
      runtime: m.runtime ?? null,
      status: movieStatus(m.status),
      contentRating: certification((m.release_dates?.results ?? []).map(r => ({ iso_3166_1: r.iso_3166_1, certs: r.release_dates.map(d => d.certification) }))),
      collection: m.belongs_to_collection ? { externalId: String(m.belongs_to_collection.id), name: m.belongs_to_collection.name, overview: null } : null,
      credits: dedupe(credits),
    },
  };
}

export function mapTv(tv: TmdbTv, opts: MapOptions): Mapped {
  const { resolved, fields } = base("tv", tv, tv.original_name, t => t.data.name, opts);
  const agg = tv.aggregate_credits ?? { cast: [], crew: [] };
  const credits: NonNullable<ImportTitle["credits"]> = [
    ...(tv.created_by ?? []).map(p => ({ person: person(p), role: "crew" as const, department: "Writing", job: "Creator" })),
    ...agg.crew.flatMap(c => c.jobs.filter(j => WRITER_JOBS.has(j.job)).slice(0, 1).map(j => ({ person: person(c), role: "crew" as const, department: c.department, job: j.job }))),
    ...[...agg.cast].sort((a, b) => a.order - b.order).slice(0, opts.cast).map(c => ({ person: person(c), role: "cast" as const, character: text(c.roles?.[0]?.character) })),
  ];
  return {
    resolved,
    title: {
      kind: "series",
      ...fields,
      originCountries: tv.origin_country ?? [],
      releaseDate: text(tv.first_air_date),
      runtime: tv.episode_run_time?.[0] ?? null,
      status: tvStatus(tv.status, text(tv.first_air_date)),
      contentRating: certification((tv.content_ratings?.results ?? []).map(r => ({ iso_3166_1: r.iso_3166_1, certs: [r.rating] }))),
      collection: null,
      seasons: (tv.seasons ?? []).map(s => ({
        number: s.season_number,
        name: text(s.name),
        overview: text(s.overview),
        airDate: text(s.air_date),
        episodeTotal: s.episode_count,
        poster: img("w500", s.poster_path),
      })),
      credits: dedupe(credits),
    },
  };
}

/** One credit per person and role: TMDB lists a director-writer twice. */
function dedupe(credits: NonNullable<ImportTitle["credits"]>): NonNullable<ImportTitle["credits"]> {
  const seen = new Set<string>();
  return credits.filter((c) => {
    const key = `${c.role}:${c.person.externalId}`;
    if (seen.has(key))
      return false;
    seen.add(key);
    return true;
  });
}

// ─── HTTP ───

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const RETRIES = 4;
const PAGE_SIZE = 20;
const MAX_PAGE = 500;

/** A TMDB client: v4 read access token as a bearer, v3 key as a query parameter; waits out 429s. */
export function tmdbClient(token: string, fetchImpl: Fetch = fetch, sleep: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)), baseUrl = "https://api.themoviedb.org/3") {
  const bearer = token.startsWith("eyJ");
  return async <T>(path: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> => {
    const url = new URL(`${baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined)
        url.searchParams.set(k, String(v));
    }
    if (!bearer)
      url.searchParams.set("api_key", token);
    for (let attempt = 1; ; attempt++) {
      let res: Response | undefined;
      try {
        res = await fetchImpl(url.toString(), { headers: { accept: "application/json", ...(bearer ? { authorization: `Bearer ${token}` } : {}) }, signal: AbortSignal.timeout(30_000) });
      }
      catch (err) {
        if (attempt > RETRIES)
          throw err;
      }
      if (res?.ok)
        return (await res.json()) as T;
      if (res && res.status < 500 && res.status !== 429)
        throw new Error(`TMDB ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
      if (attempt > RETRIES)
        throw new Error(`TMDB ${path} → ${res?.status ?? "network error"} after ${RETRIES} retries`);
      const retryAfter = Number(res?.headers.get("retry-after"));
      await sleep(res?.status === 429 && retryAfter > 0 ? retryAfter * 1000 : attempt * 1000);
    }
  };
}

export type TmdbCall = ReturnType<typeof tmdbClient>;

export interface Ranked { readonly id: number; readonly rank: number }

export interface DiscoverOptions {
  readonly count: number;
  readonly minVotes: number;
  readonly language: string;
  /** TV: genres left out (news, talk). */
  readonly withoutGenres?: readonly number[] | undefined;
}

/**
 * The best-rated `count` ids of a kind, worst first: pages from the last to
 * the first and each page reversed, so the caller writes the best title last
 * and it tops the "latest" order. Fewer than `count` when TMDB has fewer.
 */
export async function rankedIds(call: TmdbCall, kind: Kind, opts: DiscoverOptions, onPage?: (page: number, pages: number) => void): Promise<Ranked[]> {
  const pages = Math.min(Math.ceil(opts.count / PAGE_SIZE), MAX_PAGE);
  const out: Ranked[] = [];
  for (let page = pages; page >= 1; page--) {
    const data = await call<{ results: { id: number }[]; total_pages: number }>(`/discover/${kind}`, {
      "sort_by": "vote_average.desc",
      "vote_count.gte": opts.minVotes,
      "include_adult": false,
      "include_video": kind === "movie" ? false : undefined,
      "language": opts.language,
      "page": page,
      "without_genres": opts.withoutGenres?.length ? opts.withoutGenres.join(",") : undefined,
    });
    onPage?.(page, pages);
    const ranked = data.results.map((r, i) => ({ id: r.id, rank: (page - 1) * PAGE_SIZE + i + 1 })).filter(r => r.rank <= opts.count);
    out.push(...ranked.reverse());
  }
  return out;
}

export async function detail<T extends TmdbMovie | TmdbTv>(call: TmdbCall, kind: Kind, id: number, language: string): Promise<T> {
  return await call<T>(`/${kind}/${id}`, { language, append_to_response: DETAIL_APPEND[kind], include_image_language: `${language.slice(0, 2)},en,null` });
}

/** Run `fn` over `items` with at most `limit` in flight, results in order. */
export async function pool<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = Array.from({ length: items.length });
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++)
      out[i] = await fn(items[i]!, i);
  }));
  return out;
}
