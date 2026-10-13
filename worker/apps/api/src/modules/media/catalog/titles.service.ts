import type { SQL } from "drizzle-orm";
import type { TxOrDb } from "../shared/db";
import type { TitleKind } from "../taxonomy/taxonomy.service";
import type { AppDatabase } from "@/db";
import { and, count, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { chunked } from "@/shared/lib/chunk";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { mediaCollections, mediaEpisodes, mediaGenres, mediaSeasons, mediaTitleAliases, mediaTitleGenres, mediaTitles } from "../schema";
import { deleteOwned, deleteSeasonOwned } from "../shared/owners";
import { getCategory } from "../taxonomy/taxonomy.service";

type TitleRow = typeof mediaTitles.$inferSelect;
type AliasRow = typeof mediaTitleAliases.$inferSelect;
export type TitleStatus = TitleRow["status"];
export type PublishState = TitleRow["publishState"];

export interface AliasInput {
  readonly name: string;
  readonly locale?: string | null | undefined;
  readonly kind?: AliasRow["kind"] | undefined;
}

export interface TitleView extends Omit<TitleRow, "originCountries"> {
  readonly originCountries: string[];
  readonly genreIds: string[];
  readonly aliases: Omit<AliasRow, "titleId">[];
  readonly seasonCount: number;
}

export interface TitleInput {
  readonly categoryId: string;
  readonly title: string;
  readonly originalTitle?: string | null | undefined;
  readonly originalLanguage?: string | null | undefined;
  readonly originCountries?: readonly string[] | undefined;
  readonly overview?: string | null | undefined;
  readonly tagline?: string | null | undefined;
  readonly releaseDate?: string | null | undefined;
  readonly runtime?: number | null | undefined;
  readonly status?: TitleStatus | undefined;
  readonly statusLocked?: boolean | undefined;
  readonly contentRating?: string | null | undefined;
  readonly isAdult?: boolean | undefined;
  readonly voteAverage?: number | null | undefined;
  readonly voteCount?: number | null | undefined;
  readonly popularity?: number | undefined;
  readonly collectionId?: string | null | undefined;
  readonly publishState?: PublishState | undefined;
  readonly origin?: string | null | undefined;
  readonly sort?: number | undefined;
  readonly genreIds?: readonly string[] | undefined;
  readonly aliases?: readonly AliasInput[] | undefined;
}

export type TitlePatch = { [K in keyof TitleInput]?: TitleInput[K] | undefined };

export interface CreateTitleInput extends TitleInput {
  readonly kind: TitleKind;
}

async function viewsOf(db: AppDatabase, rows: readonly TitleRow[]): Promise<TitleView[]> {
  const ids = rows.map(r => r.id);
  const genres: { titleId: number; genreId: string }[] = [];
  const aliases: AliasRow[] = [];
  const seasons: { titleId: number; n: number }[] = [];
  for (const part of chunked(ids)) {
    genres.push(...await db.select().from(mediaTitleGenres).where(inArray(mediaTitleGenres.titleId, part)).all());
    aliases.push(...await db.select().from(mediaTitleAliases).where(inArray(mediaTitleAliases.titleId, part)).orderBy(mediaTitleAliases.id).all());
    seasons.push(...await db.select({ titleId: mediaSeasons.titleId, n: count() }).from(mediaSeasons).where(inArray(mediaSeasons.titleId, part)).groupBy(mediaSeasons.titleId).all());
  }
  return rows.map(r => ({
    ...r,
    originCountries: JSON.parse(r.originCountries) as string[],
    genreIds: genres.filter(g => g.titleId === r.id).map(g => g.genreId),
    aliases: aliases.filter(a => a.titleId === r.id).map(({ titleId: _, ...a }) => a),
    seasonCount: seasons.find(s => s.titleId === r.id)?.n ?? 0,
  }));
}

export async function getTitle(db: AppDatabase, id: number): Promise<TitleView> {
  const row = await db.select().from(mediaTitles).where(eq(mediaTitles.id, id)).get();
  if (!row)
    throw new NotFoundError("Title", String(id));
  return (await viewsOf(db, [row]))[0]!;
}

export interface TitleQuery {
  readonly categoryId?: string | undefined;
  readonly kind?: TitleKind | undefined;
  readonly publishState?: PublishState | undefined;
  readonly genreId?: string | undefined;
  readonly collectionId?: string | undefined;
  readonly q?: string | undefined;
  readonly page: number;
  readonly limit: number;
}

/** Newest first. `q` matches the title, the original title and aliases. */
export async function listTitles(db: AppDatabase, query: TitleQuery): Promise<{ items: TitleView[]; total: number }> {
  const where: SQL[] = [];
  if (query.categoryId)
    where.push(eq(mediaTitles.categoryId, query.categoryId));
  if (query.kind)
    where.push(eq(mediaTitles.kind, query.kind));
  if (query.publishState)
    where.push(eq(mediaTitles.publishState, query.publishState));
  if (query.collectionId)
    where.push(eq(mediaTitles.collectionId, query.collectionId));
  if (query.genreId)
    where.push(inArray(mediaTitles.id, db.select({ id: mediaTitleGenres.titleId }).from(mediaTitleGenres).where(eq(mediaTitleGenres.genreId, query.genreId))));
  if (query.q) {
    const pattern = `%${query.q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    where.push(or(
      sql`${mediaTitles.title} LIKE ${pattern} ESCAPE '\\'`,
      sql`${mediaTitles.originalTitle} LIKE ${pattern} ESCAPE '\\'`,
      inArray(mediaTitles.id, db.select({ id: mediaTitleAliases.titleId }).from(mediaTitleAliases).where(like(mediaTitleAliases.name, pattern))),
    )!);
  }
  const condition = where.length > 0 ? and(...where) : undefined;
  const total = (await db.select({ n: count() }).from(mediaTitles).where(condition).get())?.n ?? 0;
  const rows = await db.select().from(mediaTitles).where(condition).orderBy(desc(mediaTitles.updatedAt), desc(mediaTitles.id)).limit(query.limit).offset((query.page - 1) * query.limit).all();
  return { items: await viewsOf(db, rows), total };
}

async function assertCategoryAccepts(db: AppDatabase, categoryId: string, kind: TitleKind): Promise<void> {
  const category = await getCategory(db, categoryId);
  if (!category.kinds.includes(kind))
    throw new AppError(`Category "${category.name}" does not take ${kind} titles`, 422, "CATEGORY_KIND_MISMATCH");
}

async function assertGenres(db: AppDatabase, ids: readonly string[]): Promise<void> {
  const unique = [...new Set(ids)];
  for (const part of chunked(unique)) {
    const found = await db.select({ id: mediaGenres.id }).from(mediaGenres).where(inArray(mediaGenres.id, part)).all();
    const missing = part.find(id => !found.some(f => f.id === id));
    if (missing)
      throw new NotFoundError("Genre", missing);
  }
}

async function assertCollection(db: AppDatabase, id: string | null | undefined): Promise<void> {
  if (!id)
    return;
  const found = await db.select({ id: mediaCollections.id }).from(mediaCollections).where(eq(mediaCollections.id, id)).get();
  if (!found)
    throw new NotFoundError("Collection", id);
}

function columns(input: TitlePatch) {
  const set = <K extends keyof TitlePatch>(key: K) => input[key] !== undefined ? { [key]: input[key] } : {};
  return {
    ...set("categoryId"),
    ...set("title"),
    ...set("originalTitle"),
    ...set("originalLanguage"),
    ...(input.originCountries !== undefined ? { originCountries: JSON.stringify(input.originCountries) } : {}),
    ...set("overview"),
    ...set("tagline"),
    ...set("releaseDate"),
    ...set("runtime"),
    ...set("status"),
    ...set("statusLocked"),
    ...set("contentRating"),
    ...set("isAdult"),
    ...set("voteAverage"),
    ...set("voteCount"),
    ...set("popularity"),
    ...set("collectionId"),
    ...set("publishState"),
    ...set("origin"),
    ...set("sort"),
  } as Partial<typeof mediaTitles.$inferInsert>;
}

async function writeRelations(db: TxOrDb, id: number, input: TitlePatch): Promise<void> {
  if (input.genreIds !== undefined) {
    await db.delete(mediaTitleGenres).where(eq(mediaTitleGenres.titleId, id)).run();
    const genreIds = [...new Set(input.genreIds)];
    if (genreIds.length > 0)
      await db.insert(mediaTitleGenres).values(genreIds.map(genreId => ({ titleId: id, genreId }))).run();
  }
  if (input.aliases !== undefined) {
    await db.delete(mediaTitleAliases).where(eq(mediaTitleAliases.titleId, id)).run();
    for (const alias of input.aliases)
      await db.insert(mediaTitleAliases).values({ id: ulid(), titleId: id, name: alias.name, locale: alias.locale ?? null, kind: alias.kind ?? "alias" }).run();
  }
}

/** A series starts with an empty season 1: every episode belongs to a season. */
export async function createTitle(db: AppDatabase, input: CreateTitleInput): Promise<TitleView> {
  await assertCategoryAccepts(db, input.categoryId, input.kind);
  if (input.genreIds)
    await assertGenres(db, input.genreIds);
  await assertCollection(db, input.collectionId);
  const id = await db.transaction(async (tx) => {
    const [row] = await tx.insert(mediaTitles).values({
      ...columns(input),
      kind: input.kind,
      categoryId: input.categoryId,
      title: input.title,
      status: input.status ?? (input.kind === "series" ? "returning" : "released"),
    } as typeof mediaTitles.$inferInsert).returning({ id: mediaTitles.id }).all();
    await writeRelations(tx, row!.id, input);
    if (input.kind === "series")
      await tx.insert(mediaSeasons).values({ titleId: row!.id, seasonNumber: 1, sort: 1 }).run();
    return row!.id;
  });
  return await getTitle(db, id);
}

export async function updateTitle(db: AppDatabase, id: number, input: TitlePatch): Promise<TitleView> {
  const current = await getTitle(db, id);
  if (input.categoryId !== undefined && input.categoryId !== current.categoryId)
    await assertCategoryAccepts(db, input.categoryId, current.kind);
  if (input.genreIds)
    await assertGenres(db, input.genreIds);
  await assertCollection(db, input.collectionId);
  await db.transaction(async (tx) => {
    await tx.update(mediaTitles).set({ ...columns(input), updatedAt: new Date().toISOString() }).where(eq(mediaTitles.id, id)).run();
    await writeRelations(tx, id, input);
  });
  if (current.kind === "series" && input.statusLocked === false)
    await refreshSeriesStatus(db, id);
  return await getTitle(db, id);
}

/** Seasons, episodes, sources, credits go with it (foreign keys); images and external ids here. */
export async function deleteTitle(db: AppDatabase, id: number): Promise<TitleView> {
  const current = await getTitle(db, id);
  const seasons = await db.select({ id: mediaSeasons.id }).from(mediaSeasons).where(eq(mediaSeasons.titleId, id)).all();
  await db.transaction(async (tx) => {
    await deleteSeasonOwned(tx, seasons.map(s => s.id));
    await deleteOwned(tx, "title", [id]);
    await tx.delete(mediaTitles).where(eq(mediaTitles.id, id)).run();
  });
  return current;
}

/** Touch the title so "recently updated" ordering sees changes below it (a new episode, …). */
export async function touchTitle(db: AppDatabase, id: number): Promise<void> {
  await db.update(mediaTitles).set({ updatedAt: new Date().toISOString() }).where(eq(mediaTitles.id, id)).run();
}

/**
 * A series' status follows its published seasons unless set by hand:
 * nothing aired yet → upcoming, all ended → ended, otherwise (airing, or a
 * new season announced) → returning.
 */
export async function refreshSeriesStatus(db: AppDatabase, titleId: number): Promise<void> {
  const title = await db.select({ kind: mediaTitles.kind, locked: mediaTitles.statusLocked, status: mediaTitles.status }).from(mediaTitles).where(eq(mediaTitles.id, titleId)).get();
  if (!title || title.kind !== "series" || title.locked || title.status === "canceled")
    return;
  const seasons = await db.select({ status: mediaSeasons.status }).from(mediaSeasons).where(and(eq(mediaSeasons.titleId, titleId), eq(mediaSeasons.publishState, "published"))).all();
  const status: TitleStatus = seasons.every(s => s.status === "upcoming")
    ? "upcoming"
    : seasons.every(s => s.status === "ended") ? "ended" : "returning";
  if (status !== title.status)
    await db.update(mediaTitles).set({ status }).where(eq(mediaTitles.id, titleId)).run();
}

/** Episode counts per season of a title, for the admin list. */
export async function episodeCounts(db: AppDatabase, seasonIds: readonly number[]): Promise<Map<number, { total: number; published: number }>> {
  const out = new Map<number, { total: number; published: number }>();
  for (const part of chunked(seasonIds)) {
    const rows = await db.select({ seasonId: mediaEpisodes.seasonId, state: mediaEpisodes.publishState, n: count() })
      .from(mediaEpisodes)
      .where(inArray(mediaEpisodes.seasonId, part))
      .groupBy(mediaEpisodes.seasonId, mediaEpisodes.publishState)
      .all();
    for (const r of rows) {
      const entry = out.get(r.seasonId) ?? { total: 0, published: 0 };
      entry.total += r.n;
      if (r.state === "published")
        entry.published += r.n;
      out.set(r.seasonId, entry);
    }
  }
  return out;
}
