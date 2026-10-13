import type { ReadModelDb } from "@/modules/media/readmodel/store";

/**
 * Read-model queries behind the native API. Every list pages by an index, so
 * a request reads about as many rows as it returns.
 */

export const BROWSE_SORTS = ["updated", "popular", "release", "rating", "manual"] as const;
export type BrowseSort = typeof BROWSE_SORTS[number];

// Column, direction: id DESC breaks ties everywhere.
const SORT_COLUMNS: Record<BrowseSort, { column: string; desc: boolean }> = {
  updated: { column: "updated_at", desc: true },
  popular: { column: "popularity", desc: true },
  release: { column: "release_key", desc: true },
  rating: { column: "rating", desc: true },
  manual: { column: "manual_sort", desc: false },
};

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

function whereOf(filter: TitleFilter, alias = "t"): { sql: string[]; params: unknown[] } {
  const sql: string[] = [];
  const params: unknown[] = [];
  if (filter.category) {
    sql.push(`${alias}.category_id = ?`);
    params.push(filter.category);
  }
  if (filter.type) {
    sql.push(`${alias}.type = ?`);
    params.push(filter.type);
  }
  if (filter.year !== undefined) {
    sql.push(`${alias}.year = ?`);
    params.push(filter.year);
  }
  if (filter.country) {
    sql.push(`${alias}.country = ?`);
    params.push(filter.country);
  }
  if (filter.genre) {
    sql.push(`${alias}.id IN (SELECT title_id FROM rm_title_genres WHERE genre_id = ?)`);
    params.push(filter.genre);
  }
  return { sql, params };
}

/** One page of cards; `cursor` continues where the last page stopped. */
export async function browse(
  rm: ReadModelDb,
  filter: TitleFilter,
  sort: BrowseSort,
  limit: number,
  cursor: string | undefined,
): Promise<{ cards: string[]; cursor: string | null }> {
  const { column, desc } = SORT_COLUMNS[sort];
  const where = whereOf(filter);
  const after = decodeCursor<[string | number, number]>(cursor);
  if (after) {
    where.sql.push(`(t.${column} ${desc ? "<" : ">"} ? OR (t.${column} = ? AND t.id < ?))`);
    where.params.push(after[0], after[0], after[1]);
  }
  const sql = `SELECT t.id, t.${column} AS k, t.card_json FROM rm_titles t${where.sql.length ? ` WHERE ${where.sql.join(" AND ")}` : ""} ORDER BY t.${column} ${desc ? "DESC" : "ASC"}, t.id DESC LIMIT ?`;
  const { results } = await rm.prepare(sql).bind(...where.params, limit + 1).all<{ id: number; k: string | number; card_json: string }>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return { cards: page.map(r => r.card_json), cursor: results.length > limit && last ? encodeCursor([last.k, last.id]) : null };
}

/** Value counts per facet among titles matching the other facets' filters. */
export async function facetCounts(rm: ReadModelDb, filter: TitleFilter): Promise<{ genre: [string, number][]; year: [string, number][]; country: [string, number][] }> {
  const without = (key: keyof TitleFilter) => whereOf({ ...filter, [key]: undefined });
  const run = async (sql: string, params: unknown[]) =>
    (await rm.prepare(sql).bind(...params).all<{ v: string | number; n: number }>()).results.map(r => [String(r.v), r.n] as [string, number]);
  const g = without("genre");
  const y = without("year");
  const c = without("country");
  const and = (w: { sql: string[] }) => (w.sql.length ? ` AND ${w.sql.join(" AND ")}` : "");
  return {
    genre: await run(`SELECT g.genre_id AS v, COUNT(*) AS n FROM rm_title_genres g JOIN rm_titles t ON t.id = g.title_id WHERE 1 = 1${and(g)} GROUP BY g.genre_id ORDER BY n DESC`, g.params),
    year: await run(`SELECT t.year AS v, COUNT(*) AS n FROM rm_titles t WHERE t.year IS NOT NULL${and(y)} GROUP BY t.year ORDER BY t.year DESC`, y.params),
    country: await run(`SELECT t.country AS v, COUNT(*) AS n FROM rm_titles t WHERE t.country IS NOT NULL${and(c)} GROUP BY t.country ORDER BY n DESC`, c.params),
  };
}

export async function meta<T>(rm: ReadModelDb, key: string): Promise<T | null> {
  const row = await rm.prepare("SELECT value FROM rm_meta WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? JSON.parse(row.value) as T : null;
}

/** The stored JSON of one document, or null. */
export async function document(rm: ReadModelDb, table: "titles" | "seasons" | "playback" | "people" | "collections", id: string | number): Promise<string | null> {
  const column = table === "titles" || table === "seasons" ? "detail_json" : "json";
  const row = await rm.prepare(`SELECT ${column} AS doc FROM rm_${table} WHERE id = ?`).bind(id).first<{ doc: string }>();
  return row?.doc ?? null;
}

export async function rowPage(rm: ReadModelDb, rowId: string, offset: number, limit: number): Promise<{ name: string; cards: string[]; cursor: string | null } | null> {
  const row = await rm.prepare("SELECT name FROM rm_rows WHERE id = ?").bind(rowId).first<{ name: string }>();
  if (!row)
    return null;
  const { results } = await rm.prepare("SELECT t.card_json FROM rm_row_items i JOIN rm_titles t ON t.id = i.title_id WHERE i.row_id = ? AND i.sort >= ? ORDER BY i.sort LIMIT ?")
    .bind(rowId, offset, limit + 1)
    .all<{ card_json: string }>();
  return {
    name: row.name,
    cards: results.slice(0, limit).map(r => r.card_json),
    cursor: results.length > limit ? String(offset + limit) : null,
  };
}

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
}

/**
 * Title and person refs matching `q`, best first. The trigram index needs
 * three characters; shorter queries (common in Chinese) scan by LIKE.
 */
export async function searchRefs(rm: ReadModelDb, q: string, offset: number, limit: number, only?: "t" | "p"): Promise<string[]> {
  const kind = only ? ` AND ref LIKE '${only}%'` : "";
  const stmt = [...q].length >= 3
    ? rm.prepare(`SELECT ref FROM rm_search WHERE rm_search MATCH ?${kind} ORDER BY rank LIMIT ? OFFSET ?`).bind(`"${q.replace(/"/g, "\"\"")}"`, limit, offset)
    : rm.prepare(`SELECT ref FROM rm_search WHERE text LIKE ? ESCAPE '\\'${kind} ORDER BY ref LIMIT ? OFFSET ?`).bind(likePattern(q), limit, offset);
  return (await stmt.all<{ ref: string }>()).results.map(r => r.ref);
}

/** Documents by id, in the order asked for. */
export async function documentsByIds(rm: ReadModelDb, table: "titles" | "people", ids: readonly number[], column: "card_json" | "json"): Promise<string[]> {
  if (ids.length === 0)
    return [];
  const { results } = await rm.prepare(`SELECT id, ${column} AS doc FROM rm_${table} WHERE id IN (${ids.map(() => "?").join(", ")})`).bind(...ids).all<{ id: number; doc: string }>();
  const byId = new Map(results.map(r => [r.id, r.doc]));
  return ids.map(id => byId.get(id)).filter((d): d is string => d !== undefined);
}
