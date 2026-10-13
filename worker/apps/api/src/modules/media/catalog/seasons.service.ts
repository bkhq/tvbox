import type { AppDatabase } from "@/db";
import { and, asc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { chunked } from "@/shared/lib/chunk";
import { AppError, isUniqueViolation, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { mediaEpisodes, mediaSeasons, mediaTitles } from "../schema";
import { deleteOwned, deleteSeasonOwned } from "../shared/owners";
import { episodeCounts, refreshSeriesStatus, touchTitle } from "./titles.service";

type SeasonRow = typeof mediaSeasons.$inferSelect;
export type EpisodeRow = typeof mediaEpisodes.$inferSelect;

export interface SeasonView extends SeasonRow {
  readonly episodeCount: number;
  readonly publishedEpisodeCount: number;
}

export interface SeasonInput {
  readonly seasonNumber?: number | undefined;
  readonly name?: string | null | undefined;
  readonly overview?: string | null | undefined;
  readonly airDate?: string | null | undefined;
  readonly endDate?: string | null | undefined;
  readonly status?: SeasonRow["status"] | undefined;
  readonly episodeTotal?: number | null | undefined;
  readonly updateSchedule?: string | null | undefined;
  readonly contentRating?: string | null | undefined;
  readonly publishState?: SeasonRow["publishState"] | undefined;
  readonly sort?: number | undefined;
}

export interface EpisodeInput {
  readonly episodeNumber?: number | undefined;
  readonly episodeType?: EpisodeRow["episodeType"] | undefined;
  readonly name?: string | null | undefined;
  readonly overview?: string | null | undefined;
  readonly airDate?: string | null | undefined;
  readonly runtime?: number | null | undefined;
  readonly publishState?: EpisodeRow["publishState"] | undefined;
}

function pick<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

async function guardNumber<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  }
  catch (err) {
    if (isUniqueViolation(err))
      throw new AppError(`${what} number is already taken`, 409, "NUMBER_TAKEN");
    throw err;
  }
}

// ─── Seasons ───

async function seasonRow(db: AppDatabase, id: number): Promise<SeasonRow> {
  const row = await db.select().from(mediaSeasons).where(eq(mediaSeasons.id, id)).get();
  if (!row)
    throw new NotFoundError("Season", String(id));
  return row;
}

export async function getSeason(db: AppDatabase, id: number): Promise<SeasonView> {
  const row = await seasonRow(db, id);
  const counts = (await episodeCounts(db, [id])).get(id);
  return { ...row, episodeCount: counts?.total ?? 0, publishedEpisodeCount: counts?.published ?? 0 };
}

export async function listSeasons(db: AppDatabase, titleId: number): Promise<SeasonView[]> {
  const rows = await db.select().from(mediaSeasons).where(eq(mediaSeasons.titleId, titleId)).orderBy(asc(mediaSeasons.sort), asc(mediaSeasons.seasonNumber)).all();
  const counts = await episodeCounts(db, rows.map(r => r.id));
  return rows.map(r => ({ ...r, episodeCount: counts.get(r.id)?.total ?? 0, publishedEpisodeCount: counts.get(r.id)?.published ?? 0 }));
}

export async function createSeason(db: AppDatabase, titleId: number, input: SeasonInput & { seasonNumber: number }): Promise<SeasonView> {
  const title = await db.select({ kind: mediaTitles.kind }).from(mediaTitles).where(eq(mediaTitles.id, titleId)).get();
  if (!title)
    throw new NotFoundError("Title", String(titleId));
  if (title.kind !== "series")
    throw new AppError("Only a series has seasons", 422, "NOT_A_SERIES");
  const [row] = await guardNumber("Season", () => db.insert(mediaSeasons).values({
    ...pick(input),
    titleId,
    seasonNumber: input.seasonNumber,
    sort: input.sort ?? input.seasonNumber,
  }).returning({ id: mediaSeasons.id }).all());
  await refreshSeriesStatus(db, titleId);
  await touchTitle(db, titleId);
  return await getSeason(db, row!.id);
}

export async function updateSeason(db: AppDatabase, id: number, input: SeasonInput): Promise<SeasonView> {
  const current = await seasonRow(db, id);
  await guardNumber("Season", () => db.update(mediaSeasons).set({ ...pick(input), updatedAt: new Date().toISOString() }).where(eq(mediaSeasons.id, id)).run());
  await refreshSeriesStatus(db, current.titleId);
  await touchTitle(db, current.titleId);
  return await getSeason(db, id);
}

/** Its episodes, sources and credits go with it. */
export async function deleteSeason(db: AppDatabase, id: number): Promise<SeasonView> {
  const current = await getSeason(db, id);
  await db.transaction(async (tx) => {
    await deleteSeasonOwned(tx, [id]);
    await tx.delete(mediaSeasons).where(eq(mediaSeasons.id, id)).run();
  });
  await refreshSeriesStatus(db, current.titleId);
  await touchTitle(db, current.titleId);
  return current;
}

// ─── Episodes ───

export async function getEpisode(db: AppDatabase, id: string): Promise<EpisodeRow> {
  const row = await db.select().from(mediaEpisodes).where(eq(mediaEpisodes.id, id)).get();
  if (!row)
    throw new NotFoundError("Episode", id);
  return row;
}

export async function listEpisodes(db: AppDatabase, seasonId: number): Promise<EpisodeRow[]> {
  await seasonRow(db, seasonId);
  return await db.select().from(mediaEpisodes).where(eq(mediaEpisodes.seasonId, seasonId)).orderBy(asc(mediaEpisodes.episodeNumber)).all();
}

export async function createEpisode(db: AppDatabase, seasonId: number, input: EpisodeInput & { episodeNumber: number }): Promise<EpisodeRow> {
  const season = await seasonRow(db, seasonId);
  const id = ulid();
  await guardNumber("Episode", () => db.insert(mediaEpisodes).values({ ...pick(input), id, seasonId, episodeNumber: input.episodeNumber }).run());
  await touchTitle(db, season.titleId);
  return await getEpisode(db, id);
}

export async function updateEpisode(db: AppDatabase, id: string, input: EpisodeInput): Promise<EpisodeRow> {
  const current = await getEpisode(db, id);
  await guardNumber("Episode", () => db.update(mediaEpisodes).set({ ...pick(input), updatedAt: new Date().toISOString() }).where(eq(mediaEpisodes.id, id)).run());
  const season = await seasonRow(db, current.seasonId);
  await touchTitle(db, season.titleId);
  return await getEpisode(db, id);
}

/** Its streams go with it. */
export async function deleteEpisode(db: AppDatabase, id: string): Promise<EpisodeRow> {
  const current = await getEpisode(db, id);
  await db.transaction(async (tx) => {
    await deleteOwned(tx, "episode", [id]);
    await tx.delete(mediaEpisodes).where(eq(mediaEpisodes.id, id)).run();
  });
  const season = await seasonRow(db, current.seasonId);
  await touchTitle(db, season.titleId);
  return current;
}

/** Create episodes `from`..`to`, skipping numbers that exist. Returns how many were added. */
export async function generateEpisodes(db: AppDatabase, seasonId: number, from: number, to: number): Promise<number> {
  if (to < from || to - from >= 1000)
    throw new AppError("Give a range of at most 1000 episodes", 422, "INVALID_RANGE");
  const season = await seasonRow(db, seasonId);
  const existing = new Set((await db.select({ n: mediaEpisodes.episodeNumber }).from(mediaEpisodes).where(eq(mediaEpisodes.seasonId, seasonId)).all()).map(r => r.n));
  const numbers: number[] = [];
  for (let n = from; n <= to; n++) {
    if (!existing.has(n))
      numbers.push(n);
  }
  await db.transaction(async (tx) => {
    for (const n of numbers)
      await tx.insert(mediaEpisodes).values({ id: ulid(), seasonId, episodeNumber: n }).run();
  });
  if (numbers.length > 0)
    await touchTitle(db, season.titleId);
  return numbers.length;
}

/**
 * Add `delta` to every episode number from `from` on (to make room for a
 * missed episode, or close a gap). Goes through negative numbers so the
 * unique index never sees two episodes on one number mid-way.
 */
export async function shiftEpisodes(db: AppDatabase, seasonId: number, from: number, delta: number): Promise<number> {
  const season = await seasonRow(db, seasonId);
  const moving = await db.select({ id: mediaEpisodes.id, n: mediaEpisodes.episodeNumber }).from(mediaEpisodes).where(and(eq(mediaEpisodes.seasonId, seasonId), gte(mediaEpisodes.episodeNumber, from))).all();
  if (moving.length === 0 || delta === 0)
    return 0;
  if (moving.some(e => e.n + delta < 0))
    throw new AppError("Episode numbers cannot go below 0", 422, "INVALID_SHIFT");
  const target = new Set(moving.map(e => e.n + delta));
  const staying = await db.select({ n: mediaEpisodes.episodeNumber }).from(mediaEpisodes).where(and(eq(mediaEpisodes.seasonId, seasonId), lte(mediaEpisodes.episodeNumber, from - 1))).all();
  if (staying.some(e => target.has(e.n)))
    throw new AppError("The shift would collide with earlier episodes", 409, "NUMBER_TAKEN");
  await db.transaction(async (tx) => {
    for (const part of chunked(moving.map(e => e.id)))
      await tx.update(mediaEpisodes).set({ episodeNumber: sql`-1 - ${mediaEpisodes.episodeNumber}` }).where(inArray(mediaEpisodes.id, part)).run();
    await tx.update(mediaEpisodes).set({ episodeNumber: sql`-1 - ${mediaEpisodes.episodeNumber} + ${delta}` }).where(and(eq(mediaEpisodes.seasonId, seasonId), sql`${mediaEpisodes.episodeNumber} < 0`)).run();
  });
  await touchTitle(db, season.titleId);
  return moving.length;
}

/** Air dates `startDate`, then every `intervalDays`, for episodes from `from` on. */
export async function scheduleEpisodes(db: AppDatabase, seasonId: number, from: number, startDate: string, intervalDays: number): Promise<number> {
  const season = await seasonRow(db, seasonId);
  const episodes = await db.select({ id: mediaEpisodes.id }).from(mediaEpisodes).where(and(eq(mediaEpisodes.seasonId, seasonId), gte(mediaEpisodes.episodeNumber, from))).orderBy(asc(mediaEpisodes.episodeNumber)).all();
  const start = Date.parse(`${startDate}T00:00:00Z`);
  if (Number.isNaN(start))
    throw new AppError("startDate must be YYYY-MM-DD", 422, "INVALID_DATE");
  await db.transaction(async (tx) => {
    for (const [i, e] of episodes.entries()) {
      const airDate = new Date(start + i * intervalDays * 86_400_000).toISOString().slice(0, 10);
      await tx.update(mediaEpisodes).set({ airDate }).where(eq(mediaEpisodes.id, e.id)).run();
    }
  });
  if (episodes.length > 0)
    await touchTitle(db, season.titleId);
  return episodes.length;
}
