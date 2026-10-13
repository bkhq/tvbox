import type { TITLE_KINDS } from "../schema";
import type { AppDatabase } from "@/db";
import { count, eq, max } from "drizzle-orm";
import { chunked } from "@/shared/lib/chunk";
import { AppError, isUniqueViolation, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { mediaCategories, mediaGenres, mediaTitleGenres, mediaTitles } from "../schema";

export const FACETS = ["genre", "year", "country"] as const;
export type Facet = typeof FACETS[number];
export type TitleKind = typeof TITLE_KINDS[number];

type CategoryRow = typeof mediaCategories.$inferSelect;
export interface CategoryView extends Omit<CategoryRow, "kinds" | "filters"> {
  readonly kinds: TitleKind[];
  readonly filters: Facet[];
  readonly titleCount: number;
}
export type GenreRow = typeof mediaGenres.$inferSelect;

// A category id is what clients see (`category` in the native API, `type_id`
// in CMS), so it is a short slug rather than a ULID.
export const CATEGORY_ID = /^[a-z0-9][a-z0-9-]{0,31}$/;

const DEFAULT_CATEGORIES: { id: string; name: string; kinds: TitleKind[] }[] = [
  { id: "movie", name: "电影", kinds: ["movie"] },
  { id: "tv", name: "剧集", kinds: ["series"] },
  { id: "anime", name: "动漫", kinds: ["movie", "series"] },
  { id: "variety", name: "综艺", kinds: ["series"] },
  { id: "documentary", name: "纪录片", kinds: ["movie", "series"] },
];

// TMDB's movie and TV genre lists, merged; ids are `g<tmdb id>`.
const TMDB_GENRES: [number, string][] = [
  [28, "动作"],
  [12, "冒险"],
  [16, "动画"],
  [35, "喜剧"],
  [80, "犯罪"],
  [99, "纪录"],
  [18, "剧情"],
  [10751, "家庭"],
  [14, "奇幻"],
  [36, "历史"],
  [27, "恐怖"],
  [10402, "音乐"],
  [9648, "悬疑"],
  [10749, "爱情"],
  [878, "科幻"],
  [10770, "电视电影"],
  [53, "惊悚"],
  [10752, "战争"],
  [37, "西部"],
  [10759, "动作冒险"],
  [10762, "儿童"],
  [10763, "新闻"],
  [10764, "真人秀"],
  [10765, "科幻奇幻"],
  [10766, "肥皂剧"],
  [10767, "脱口秀"],
  [10768, "战争政治"],
];

/** First boot: the default categories and TMDB's genres. Later boots leave the tables alone. */
export async function seedTaxonomy(db: AppDatabase): Promise<void> {
  const categories = await db.select({ n: count() }).from(mediaCategories).get();
  if (!categories?.n) {
    await db.insert(mediaCategories).values(DEFAULT_CATEGORIES.map((c, i) => ({
      id: c.id,
      name: c.name,
      kinds: JSON.stringify(c.kinds),
      sort: i,
    }))).run();
  }
  const genres = await db.select({ n: count() }).from(mediaGenres).get();
  if (!genres?.n) {
    // Durable Object SQLite binds at most 100 parameters per statement.
    for (const part of chunked(TMDB_GENRES.map(([tmdbId, name], i) => ({ id: `g${tmdbId}`, name, tmdbId, sort: i })), 20))
      await db.insert(mediaGenres).values(part).run();
  }
}

// ─── Categories ───

function categoryView(row: CategoryRow, titleCount: number): CategoryView {
  return {
    ...row,
    kinds: JSON.parse(row.kinds) as TitleKind[],
    filters: JSON.parse(row.filters) as Facet[],
    titleCount,
  };
}

export async function listCategories(db: AppDatabase): Promise<CategoryView[]> {
  const rows = await db.select().from(mediaCategories).orderBy(mediaCategories.sort, mediaCategories.id).all();
  const counts = await db.select({ id: mediaTitles.categoryId, n: count() }).from(mediaTitles).groupBy(mediaTitles.categoryId).all();
  return rows.map(r => categoryView(r, counts.find(c => c.id === r.id)?.n ?? 0));
}

export async function getCategory(db: AppDatabase, id: string): Promise<CategoryView> {
  const row = await db.select().from(mediaCategories).where(eq(mediaCategories.id, id)).get();
  if (!row)
    throw new NotFoundError("Category", id);
  const n = await db.select({ n: count() }).from(mediaTitles).where(eq(mediaTitles.categoryId, id)).get();
  return categoryView(row, n?.n ?? 0);
}

export interface CategoryInput {
  readonly id: string;
  readonly name: string;
  readonly kinds: readonly TitleKind[];
  readonly filters?: readonly Facet[] | undefined;
}

export async function createCategory(db: AppDatabase, input: CategoryInput): Promise<CategoryView> {
  const last = await db.select({ sort: max(mediaCategories.sort) }).from(mediaCategories).get();
  try {
    await db.insert(mediaCategories).values({
      id: input.id,
      name: input.name,
      kinds: JSON.stringify(input.kinds),
      filters: JSON.stringify(input.filters ?? FACETS),
      sort: (last?.sort ?? -1) + 1,
    }).run();
  }
  catch (err) {
    if (isUniqueViolation(err))
      throw new AppError(`Category "${input.id}" already exists`, 409, "CATEGORY_EXISTS");
    throw err;
  }
  return await getCategory(db, input.id);
}

export async function updateCategory(
  db: AppDatabase,
  id: string,
  patch: { name?: string | undefined; kinds?: readonly TitleKind[] | undefined; filters?: readonly Facet[] | undefined },
): Promise<CategoryView> {
  const current = await getCategory(db, id);
  const dropped = patch.kinds ? current.kinds.filter(k => !patch.kinds!.includes(k)) : [];
  if (dropped.length > 0) {
    const used = await db.selectDistinct({ kind: mediaTitles.kind }).from(mediaTitles).where(eq(mediaTitles.categoryId, id)).all();
    const kind = dropped.find(k => used.some(u => u.kind === k));
    if (kind)
      throw new AppError(`Titles of kind "${kind}" are still in this category`, 409, "CATEGORY_IN_USE");
  }
  await db.update(mediaCategories).set({
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.kinds !== undefined ? { kinds: JSON.stringify(patch.kinds) } : {}),
    ...(patch.filters !== undefined ? { filters: JSON.stringify(patch.filters) } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(mediaCategories.id, id)).run();
  return await getCategory(db, id);
}

export async function deleteCategory(db: AppDatabase, id: string): Promise<CategoryView> {
  const current = await getCategory(db, id);
  if (current.titleCount > 0)
    throw new AppError("The category still has titles", 409, "CATEGORY_IN_USE");
  await db.delete(mediaCategories).where(eq(mediaCategories.id, id)).run();
  return current;
}

export async function reorderCategories(db: AppDatabase, ids: readonly string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries())
      await tx.update(mediaCategories).set({ sort: i }).where(eq(mediaCategories.id, id)).run();
  });
}

// ─── Genres ───

export async function listGenres(db: AppDatabase): Promise<GenreRow[]> {
  return await db.select().from(mediaGenres).orderBy(mediaGenres.sort, mediaGenres.id).all();
}

async function getGenre(db: AppDatabase, id: string): Promise<GenreRow> {
  const row = await db.select().from(mediaGenres).where(eq(mediaGenres.id, id)).get();
  if (!row)
    throw new NotFoundError("Genre", id);
  return row;
}

async function guardGenreName<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  }
  catch (err) {
    if (isUniqueViolation(err))
      throw new AppError("A genre with this name already exists", 409, "GENRE_EXISTS");
    throw err;
  }
}

export async function createGenre(db: AppDatabase, input: { name: string; tmdbId?: number | null | undefined }): Promise<GenreRow> {
  const id = input.tmdbId ? `g${input.tmdbId}` : `g${ulid()}`;
  const last = await db.select({ sort: max(mediaGenres.sort) }).from(mediaGenres).get();
  await guardGenreName(() => db.insert(mediaGenres).values({ id, name: input.name, tmdbId: input.tmdbId ?? null, sort: (last?.sort ?? -1) + 1 }).run());
  return await getGenre(db, id);
}

export async function updateGenre(db: AppDatabase, id: string, patch: { name?: string | undefined }): Promise<GenreRow> {
  await getGenre(db, id);
  if (patch.name !== undefined)
    await guardGenreName(() => db.update(mediaGenres).set({ name: patch.name! }).where(eq(mediaGenres.id, id)).run());
  return await getGenre(db, id);
}

/** Titles lose the genre. */
export async function deleteGenre(db: AppDatabase, id: string): Promise<GenreRow> {
  const row = await getGenre(db, id);
  await db.delete(mediaTitleGenres).where(eq(mediaTitleGenres.genreId, id)).run();
  await db.delete(mediaGenres).where(eq(mediaGenres.id, id)).run();
  return row;
}

export async function reorderGenres(db: AppDatabase, ids: readonly string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries())
      await tx.update(mediaGenres).set({ sort: i }).where(eq(mediaGenres.id, id)).run();
  });
}
