import type { SQL } from "drizzle-orm";
import type { Card, Collection, Facets, Home, Manifest, Person, Playback, SeasonDetail, TitleDetail } from "@/modules/media/contract";
import type { MediaDb } from "@/modules/media/db";
import type { mediaCredits } from "@/modules/media/schema";
import type { Audience } from "@/modules/media/serve/audience";
import type { TitleDoc } from "@/modules/media/serve/documents";
import type { RowRule } from "@/modules/media/taxonomy/rows.service";
import { and, asc, eq, sql } from "drizzle-orm";
import { SCHEMA_VERSION } from "@/modules/media/contract";
import { mediaCategories, mediaCollections, mediaGenres, mediaImages, mediaLiveChannels, mediaPeople, mediaRows } from "@/modules/media/schema";
import { seenBy } from "@/modules/media/serve/audience";
import { buildCollection, buildPerson, buildTitles, imagePicker } from "@/modules/media/serve/documents";
import { countryName, languageName } from "@/modules/media/serve/names";
import { loadSlice } from "@/modules/media/serve/slice";
import { getHero, rowRuleSchema } from "@/modules/media/taxonomy/rows.service";

/**
 * Queries behind the native API, straight over the source tables, for one
 * client (`View`). A title is live when it is published — a series also
 * needs a published season — and the client sees it when it is public or in
 * one of the client's channels. Lists select ids by index and build only the
 * page they return (`loadSlice`).
 */

export interface View extends Audience {
  readonly db: MediaDb;
}

export const BROWSE_SORTS = [
  "updated",
  "popular",
  "release",
  "rating",
  "manual",
] as const;
export type BrowseSort = typeof BROWSE_SORTS[number];

// Sort key, direction: id DESC breaks ties everywhere.
const SORT_KEYS: Record<BrowseSort, { key: SQL; desc: boolean }> = {
  updated: { key: sql`t.updated_at`, desc: true },
  popular: { key: sql`t.popularity`, desc: true },
  release: { key: sql`COALESCE(t.release_date, '')`, desc: true },
  rating: { key: sql`COALESCE(t.vote_average, 0)`, desc: true },
  manual: { key: sql`t.sort`, desc: false },
};

/** `t` is a live title that `channels` see. */
export function liveTitle(channels: readonly string[]): SQL {
  return sql`t.publish_state = 'published'
    AND (t.kind = 'movie' OR EXISTS (SELECT 1 FROM media_seasons s WHERE s.title_id = t.id AND s.publish_state = 'published'))
    AND ${seenBy(channels, sql`t.id`, sql`t.public`)}`;
}

const YEAR = sql`substr(t.release_date, 1, 4)`;
const COUNTRY = sql`json_extract(t.origin_countries, '$[0]')`;

export interface TitleFilter {
  readonly category?: string | undefined;
  readonly type?: "movie" | "series" | undefined;
  readonly genre?: string | undefined;
  readonly year?: number | undefined;
  readonly country?: string | undefined;
}

/** Cursor: the last row's sort value and id, opaque to clients. */
export function encodeCursor(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor<T>(cursor: string | undefined): T | null {
  if (!cursor)
    return null;
  try {
    return JSON.parse(atob(cursor.replace(/-/g, "+").replace(/_/g, "/"))) as T;
  }
  catch {
    return null;
  }
}

export function filterSql(channels: readonly string[], filter: TitleFilter): SQL[] {
  const out: SQL[] = [
    liveTitle(channels),
  ];
  if (filter.category)
    out.push(sql`t.category_id = ${filter.category}`);
  if (filter.type)
    out.push(sql`t.kind = ${filter.type}`);
  if (filter.year !== undefined)
    out.push(sql`${YEAR} = ${String(filter.year)}`);
  if (filter.country)
    out.push(sql`${COUNTRY} = ${filter.country}`);
  if (filter.genre)
    out.push(sql`t.id IN (SELECT title_id FROM media_title_genres WHERE genre_id = ${filter.genre})`);
  return out;
}

const allOf = (parts: SQL[]) => sql.join(parts, sql` AND `);

/** One page of live title ids; `cursor` continues where the last page stopped. */
export async function browseIds({ db, channels }: View, filter: TitleFilter, sort: BrowseSort, limit: number, cursor: string | undefined): Promise<{ ids: string[]; cursor: string | null }> {
  const { key, desc } = SORT_KEYS[sort];
  const where = filterSql(channels, filter);
  const after = decodeCursor<[string | number, string]>(cursor);
  if (after)
    where.push(sql`(${key} ${sql.raw(desc ? "<" : ">")} ${after[0]} OR (${key} = ${after[0]} AND t.id < ${after[1]}))`);
  const rows = await db.all<{ id: string; k: string | number }>(sql`SELECT t.id AS id, ${key} AS k FROM media_titles t WHERE ${allOf(where)}
    ORDER BY ${key} ${sql.raw(desc ? "DESC" : "ASC")}, t.id DESC LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    ids: page.map(r => r.id),
    cursor: rows.length > limit && last
      ? encodeCursor([last.k, last.id])
      : null,
  };
}

async function idsBy({ db, channels }: View, filter: TitleFilter, sort: BrowseSort, offset: number, limit: number): Promise<string[]> {
  const { key, desc } = SORT_KEYS[sort];
  const rows = await db.all<{ id: string }>(sql`SELECT t.id AS id FROM media_titles t WHERE ${allOf(filterSql(channels, filter))}
    ORDER BY ${key} ${sql.raw(desc ? "DESC" : "ASC")}, t.id DESC LIMIT ${limit} OFFSET ${offset}`);
  return rows.map(r => r.id);
}

/** The documents of the titles the view sees, in the order asked for; others are skipped. */
export async function titleDocs(view: View, ids: readonly string[], credits = false): Promise<TitleDoc[]> {
  if (ids.length === 0)
    return [];
  const built = buildTitles(await loadSlice(view.db, view, ids, { credits }), view.today);
  const byId = new Map(built.titles.map(t => [t.id, t]));
  return ids.map(id => byId.get(id)).filter((t): t is TitleDoc => t !== undefined);
}

export async function cards(view: View, ids: readonly string[]): Promise<Card[]> {
  return (await titleDocs(view, ids)).map(t => t.card);
}

type RowRow = typeof mediaRows.$inferSelect;

/** A row's live titles from `offset`: hand-picked in order, or the rule's selection. */
export async function rowTitleIds(view: View, row: RowRow, offset: number, limit: number): Promise<string[]> {
  if (row.kind === "rule" && row.rule) {
    const rule: RowRule = rowRuleSchema.parse(JSON.parse(row.rule));
    const end = Math.min(offset + limit, rule.limit);
    if (end <= offset)
      return [];
    return await idsBy(view, { category: rule.categoryId, type: rule.kind, genre: rule.genreId }, rule.sort, offset, end - offset);
  }
  const rows = await view.db.all<{ id: string }>(sql`SELECT t.id AS id FROM media_row_items i JOIN media_titles t ON t.id = i.title_id
    WHERE i.row_id = ${row.id} AND ${liveTitle(view.channels)} ORDER BY i.sort LIMIT ${limit} OFFSET ${offset}`);
  return rows.map(r => r.id);
}

export async function rows(db: MediaDb): Promise<RowRow[]> {
  return await db.select().from(mediaRows).orderBy(asc(mediaRows.sort), asc(mediaRows.id)).all();
}

const HOME_ROW_ITEMS = 20;

export async function home(view: View): Promise<Home> {
  const heroIds = await getHero(view.db);
  const onHome = [];
  for (const row of (await rows(view.db)).filter(r => r.onHome)) {
    const ids = await rowTitleIds(view, row, 0, HOME_ROW_ITEMS + 1);
    if (ids.length > 0)
      onHome.push({ row, ids });
  }
  const docs = new Map((await titleDocs(view, [
    ...heroIds,
    ...onHome.flatMap(r => r.ids.slice(0, HOME_ROW_ITEMS)),
  ])).map(t => [t.id, t]));
  return {
    hero: heroIds.flatMap((id) => {
      const t = docs.get(id);
      return t
        ? [
            {
              ...t.card,
              images: t.detail.images,
              overview: t.detail.overview,
              tagline: t.detail.tagline,
            },
          ]
        : [];
    }),
    rows: onHome.map(({ row, ids }) => ({
      id: row.id,
      name: row.name,
      items: ids.slice(0, HOME_ROW_ITEMS).flatMap(id => (docs.has(id)
        ? [docs.get(id)!.card]
        : [])),
      cursor: ids.length > HOME_ROW_ITEMS
        ? String(HOME_ROW_ITEMS)
        : null,
    })),
  };
}

export async function manifest(view: View): Promise<Omit<Manifest, "generation">> {
  const { db } = view;
  const live = liveTitle(view.channels);
  // Raw SQL with parameters cannot join a D1 batch.
  const [categories, genres, counts, countries, languages, liveChannels] = await Promise.all([
    db.select().from(mediaCategories).orderBy(asc(mediaCategories.sort)),
    db.select().from(mediaGenres).orderBy(asc(mediaGenres.sort)),
    db.all<{ id: string; n: number }>(sql`SELECT t.category_id AS id, COUNT(*) AS n FROM media_titles t WHERE ${live} GROUP BY t.category_id`),
    db.all<{ code: string }>(sql`SELECT DISTINCT j.value AS code FROM media_titles t, json_each(t.origin_countries) j WHERE ${live} ORDER BY code`),
    db.all<{ code: string }>(sql`SELECT DISTINCT t.original_language AS code FROM media_titles t WHERE ${live} AND t.original_language IS NOT NULL ORDER BY code`),
    db.select({ id: mediaLiveChannels.id }).from(mediaLiveChannels).where(eq(mediaLiveChannels.enabled, true)).limit(1),
  ]);
  const count = new Map(counts.map(c => [c.id, c.n]));
  const withTitles: string[] = [];
  for (const row of await rows(db)) {
    if ((await rowTitleIds(view, row, 0, 1)).length > 0)
      withTitles.push(row.id);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    categories: categories.map(c => ({
      id: c.id,
      name: c.name,
      kinds: JSON.parse(c.kinds) as ("movie" | "series")[],
      filters: JSON.parse(c.filters) as ("genre" | "year" | "country")[],
      count: count.get(c.id) ?? 0,
    })),
    genres: genres.map(g => ({ id: g.id, name: g.name })),
    countries: countries.map(c => ({
      code: c.code,
      name: countryName(c.code),
    })),
    languages: languages.map(l => ({
      code: l.code,
      name: languageName(l.code),
    })),
    rows: withTitles,
    capabilities: { live: liveChannels.length > 0 },
  };
}

/** Value counts per facet among live titles matching the other facets' filters. */
export async function facets({ db, channels }: View, filter: TitleFilter): Promise<Facets> {
  const without = (key: keyof TitleFilter) => allOf(filterSql(channels, { ...filter, [key]: undefined }));
  const [genres, genreCounts, years, countries] = await Promise.all([
    db.select({ id: mediaGenres.id, name: mediaGenres.name }).from(mediaGenres),
    db.all<{ v: string; n: number }>(sql`SELECT g.genre_id AS v, COUNT(*) AS n FROM media_title_genres g JOIN media_titles t ON t.id = g.title_id WHERE ${without("genre")} GROUP BY g.genre_id`),
    db.all<{ v: string; n: number }>(sql`SELECT ${YEAR} AS v, COUNT(*) AS n FROM media_titles t WHERE ${without("year")} AND t.release_date IS NOT NULL GROUP BY v ORDER BY v DESC`),
    db.all<{ v: string; n: number }>(sql`SELECT ${COUNTRY} AS v, COUNT(*) AS n FROM media_titles t WHERE ${without("country")} AND ${COUNTRY} IS NOT NULL GROUP BY v`),
  ]);
  const genreName = new Map(genres.map(g => [g.id, g.name]));
  return {
    genre: genreCounts.map(g => ({ value: g.v, label: genreName.get(g.v) ?? g.v, count: g.n })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    year: years.map(y => ({
      value: String(y.v),
      label: String(y.v),
      count: y.n,
    })),
    country: countries.map(c => ({
      value: c.v,
      label: countryName(c.v),
      count: c.n,
    })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
  };
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
}

/** Live titles whose name, original name, a translation or an alias contains `q`, most popular first. */
export async function searchTitleIds({ db, channels }: View, q: string, offset: number, limit: number): Promise<string[]> {
  const like = likePattern(q);
  const rows = await db.all<{ id: string }>(sql`SELECT t.id AS id FROM media_titles t WHERE ${liveTitle(channels)} AND (
      t.title LIKE ${like} ESCAPE '\\' OR t.original_title LIKE ${like} ESCAPE '\\'
      OR EXISTS (SELECT 1 FROM media_title_translations x WHERE x.title_id = t.id AND x.title LIKE ${like} ESCAPE '\\')
      OR EXISTS (SELECT 1 FROM media_title_aliases a WHERE a.title_id = t.id AND a.name LIKE ${like} ESCAPE '\\'))
    ORDER BY t.popularity DESC, t.id DESC LIMIT ${limit} OFFSET ${offset}`);
  return rows.map(r => r.id);
}

/** People credited in a live title whose name contains `q`. */
export async function searchPeople({ db, channels }: View, q: string, offset: number, limit: number): Promise<{ id: string; name: string }[]> {
  const like = likePattern(q);
  return await db.all<{ id: string; name: string }>(sql`SELECT p.id AS id, p.name AS name FROM media_people p
    WHERE (p.name LIKE ${like} ESCAPE '\\' OR p.original_name LIKE ${like} ESCAPE '\\')
      AND EXISTS (SELECT 1 FROM media_credits c JOIN media_titles t ON t.id = c.title_id WHERE c.person_id = p.id AND ${liveTitle(channels)})
    ORDER BY p.name, p.id LIMIT ${limit} OFFSET ${offset}`);
}

// ─── Documents by id ───

async function liveTitleOf(db: MediaDb, query: SQL): Promise<string | null> {
  const [row] = await db.all<{ id: string }>(query);
  return row?.id ?? null;
}

export async function titleDetail(view: View, id: string): Promise<TitleDetail | null> {
  const [doc] = await titleDocs(view, [id], true);
  return doc?.detail ?? null;
}

export async function seasonDetail(view: View, id: string): Promise<SeasonDetail | null> {
  const titleId = await liveTitleOf(view.db, sql`SELECT t.id AS id FROM media_seasons s0 JOIN media_titles t ON t.id = s0.title_id
    WHERE s0.id = ${id} AND s0.publish_state = 'published' AND ${liveTitle(view.channels)}`);
  if (!titleId)
    return null;
  const built = buildTitles(await loadSlice(view.db, view, [titleId], { credits: true }), view.today);
  return built.seasons.find(s => s.id === id)?.detail ?? null;
}

/** What a movie (by title id) or an episode plays; null unless it is available today. */
export async function playback(view: View, id: string): Promise<Playback | null> {
  const live = liveTitle(view.channels);
  const titleId = await liveTitleOf(view.db, sql`SELECT t.id AS id FROM media_titles t WHERE t.id = ${id} AND t.kind = 'movie' AND ${live}
    UNION ALL SELECT t.id FROM media_episodes e JOIN media_seasons s0 ON s0.id = e.season_id JOIN media_titles t ON t.id = s0.title_id
    WHERE e.id = ${id} AND ${live}`);
  if (!titleId)
    return null;
  const built = buildTitles(await loadSlice(view.db, view, [titleId]), view.today);
  return built.playback.find(p => p.id === id)?.doc ?? null;
}

const PERSON_TITLES = 100;

export async function person(view: View, id: string): Promise<Person | null> {
  const { db } = view;
  const p = await db.select().from(mediaPeople).where(eq(mediaPeople.id, id)).get();
  if (!p)
    return null;
  const credits = await db.all<typeof mediaCredits.$inferSelect>(sql`SELECT c.id AS id, c.person_id AS personId, c.title_id AS titleId, c.season_id AS seasonId,
      c.role AS role, c.character AS character, c.department AS department, c.job AS job, c.sort AS sort
    FROM media_credits c JOIN media_titles t ON t.id = c.title_id WHERE c.person_id = ${id} AND ${liveTitle(view.channels)}
    ORDER BY COALESCE(t.release_date, '') DESC LIMIT ${PERSON_TITLES * 3}`);
  if (credits.length === 0)
    return null;
  const ids = [
    ...new Set(credits.map(c => c.titleId)),
  ].slice(0, PERSON_TITLES);
  const docs = new Map((await titleDocs(view, ids)).map(t => [t.id, t]));
  const profiles = await db.select().from(mediaImages).where(and(eq(mediaImages.ownerType, "person"), eq(mediaImages.ownerId, id))).all();
  return buildPerson(p, credits, docs, imagePicker(profiles).image("person", id, "profile"));
}

export async function collection(view: View, id: string): Promise<Collection | null> {
  const { db } = view;
  const c = await db.select().from(mediaCollections).where(eq(mediaCollections.id, id)).get();
  if (!c)
    return null;
  const members = await db.all<{ id: string }>(sql`SELECT t.id AS id FROM media_titles t WHERE t.collection_id = ${id} AND ${liveTitle(view.channels)}
    ORDER BY COALESCE(t.release_date, ''), t.id LIMIT ${PERSON_TITLES}`);
  if (members.length === 0)
    return null;
  const art = await db.select().from(mediaImages).where(and(eq(mediaImages.ownerType, "collection"), eq(mediaImages.ownerId, id))).all();
  const { images } = imagePicker(art);
  const { poster, backdrop } = images("collection", id, ["poster", "backdrop"]);
  return buildCollection(c, await titleDocs(view, members.map(m => m.id)), { poster: poster ?? null, backdrop: backdrop ?? null });
}
