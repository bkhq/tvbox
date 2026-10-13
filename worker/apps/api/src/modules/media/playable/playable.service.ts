import type { Alignment } from "./align";
import type { AppDatabase } from "@/db";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { touchTitle } from "../catalog/titles.service";
import { mediaEpisodes, mediaSeasons, mediaSources, mediaStreams, mediaTitles } from "../schema";
import { alignLines, formatOf, parsePasted } from "./align";

export type SourceRow = typeof mediaSources.$inferSelect;
export type StreamRow = typeof mediaStreams.$inferSelect;

export interface SourceView extends SourceRow {
  readonly streamCount: number;
}

export interface StreamInput {
  readonly episodeId?: string | null | undefined;
  readonly url?: string | undefined;
  readonly format?: StreamRow["format"] | undefined;
  readonly resolution?: string | null | undefined;
  readonly audioLocale?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly referer?: string | null | undefined;
  readonly sort?: number | undefined;
}

function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The title a source's changes show up on. */
async function titleOfSource(db: AppDatabase, source: SourceRow): Promise<number> {
  if (source.titleId !== null)
    return source.titleId;
  const season = await db.select({ titleId: mediaSeasons.titleId }).from(mediaSeasons).where(eq(mediaSeasons.id, source.seasonId!)).get();
  return season!.titleId;
}

// ─── Sources ───

async function sourceRow(db: AppDatabase, id: string): Promise<SourceRow> {
  const row = await db.select().from(mediaSources).where(eq(mediaSources.id, id)).get();
  if (!row)
    throw new NotFoundError("Source", id);
  return row;
}

export async function getSource(db: AppDatabase, id: string): Promise<SourceView> {
  const row = await sourceRow(db, id);
  const streams = await db.select({ id: mediaStreams.id }).from(mediaStreams).where(eq(mediaStreams.sourceId, id)).all();
  return { ...row, streamCount: streams.length };
}

/** A movie's sources, or a season's. */
export async function listSources(db: AppDatabase, owner: { titleId: number } | { seasonId: number }): Promise<SourceView[]> {
  const where = "titleId" in owner ? eq(mediaSources.titleId, owner.titleId) : eq(mediaSources.seasonId, owner.seasonId);
  const rows = await db.select().from(mediaSources).where(where).orderBy(asc(mediaSources.sort), asc(mediaSources.id)).all();
  const out: SourceView[] = [];
  for (const row of rows) {
    const streams = await db.select({ id: mediaStreams.id }).from(mediaStreams).where(eq(mediaStreams.sourceId, row.id)).all();
    out.push({ ...row, streamCount: streams.length });
  }
  return out;
}

/** A movie's lines hang on the title, a series' on each season. */
export async function createSource(
  db: AppDatabase,
  owner: { titleId: number } | { seasonId: number },
  input: { name: string; quality?: string | null | undefined; enabled?: boolean | undefined },
): Promise<SourceView> {
  let titleId: number;
  if ("titleId" in owner) {
    const title = await db.select({ kind: mediaTitles.kind }).from(mediaTitles).where(eq(mediaTitles.id, owner.titleId)).get();
    if (!title)
      throw new NotFoundError("Title", String(owner.titleId));
    if (title.kind !== "movie")
      throw new AppError("A series' sources belong to its seasons", 422, "SOURCE_OWNER_MISMATCH");
    titleId = owner.titleId;
  }
  else {
    const season = await db.select({ titleId: mediaSeasons.titleId }).from(mediaSeasons).where(eq(mediaSeasons.id, owner.seasonId)).get();
    if (!season)
      throw new NotFoundError("Season", String(owner.seasonId));
    titleId = season.titleId;
  }
  const where = "titleId" in owner ? eq(mediaSources.titleId, owner.titleId) : eq(mediaSources.seasonId, owner.seasonId);
  const last = await db.select({ sort: max(mediaSources.sort) }).from(mediaSources).where(where).get();
  const id = ulid();
  await db.insert(mediaSources).values({
    id,
    titleId: "titleId" in owner ? owner.titleId : null,
    seasonId: "seasonId" in owner ? owner.seasonId : null,
    name: input.name,
    quality: input.quality ?? null,
    enabled: input.enabled ?? true,
    sort: (last?.sort ?? -1) + 1,
  }).run();
  await touchTitle(db, titleId);
  return await getSource(db, id);
}

export async function updateSource(db: AppDatabase, id: string, patch: { name?: string | undefined; quality?: string | null | undefined; enabled?: boolean | undefined }): Promise<SourceView> {
  const row = await sourceRow(db, id);
  await db.update(mediaSources).set({ ...defined(patch), updatedAt: new Date().toISOString() }).where(eq(mediaSources.id, id)).run();
  await touchTitle(db, await titleOfSource(db, row));
  return await getSource(db, id);
}

export async function deleteSource(db: AppDatabase, id: string): Promise<SourceView> {
  const current = await getSource(db, id);
  await db.delete(mediaSources).where(eq(mediaSources.id, id)).run();
  await touchTitle(db, await titleOfSource(db, current));
  return current;
}

export async function reorderSources(db: AppDatabase, ids: readonly string[]): Promise<void> {
  await db.transaction(async (tx) => {
    for (const [i, id] of ids.entries())
      await tx.update(mediaSources).set({ sort: i }).where(eq(mediaSources.id, id)).run();
  });
}

// ─── Streams ───

export async function listStreams(db: AppDatabase, sourceId: string): Promise<StreamRow[]> {
  await sourceRow(db, sourceId);
  return await db.select().from(mediaStreams).where(eq(mediaStreams.sourceId, sourceId)).orderBy(asc(mediaStreams.episodeId), asc(mediaStreams.sort), asc(mediaStreams.id)).all();
}

async function getStream(db: AppDatabase, id: string): Promise<StreamRow> {
  const row = await db.select().from(mediaStreams).where(eq(mediaStreams.id, id)).get();
  if (!row)
    throw new NotFoundError("Stream", id);
  return row;
}

/** A movie source's streams have no episode; a season source's need one of that season. */
async function assertEpisodeFits(db: AppDatabase, source: SourceRow, episodeId: string | null | undefined): Promise<void> {
  if (source.titleId !== null) {
    if (episodeId)
      throw new AppError("A movie's streams have no episode", 422, "EPISODE_MISMATCH");
    return;
  }
  if (!episodeId)
    throw new AppError("A season's streams need an episode", 422, "EPISODE_MISMATCH");
  const episode = await db.select({ seasonId: mediaEpisodes.seasonId }).from(mediaEpisodes).where(eq(mediaEpisodes.id, episodeId)).get();
  if (!episode || episode.seasonId !== source.seasonId)
    throw new AppError("The episode is not in this source's season", 422, "EPISODE_MISMATCH");
}

export async function addStream(db: AppDatabase, sourceId: string, input: StreamInput & { url: string }): Promise<StreamRow> {
  const source = await sourceRow(db, sourceId);
  await assertEpisodeFits(db, source, input.episodeId);
  const id = ulid();
  await db.insert(mediaStreams).values({ ...defined(input), id, sourceId, url: input.url, format: input.format ?? formatOf(input.url) }).run();
  await touchTitle(db, await titleOfSource(db, source));
  return await getStream(db, id);
}

export async function updateStream(db: AppDatabase, id: string, input: StreamInput): Promise<StreamRow> {
  const current = await getStream(db, id);
  const source = await sourceRow(db, current.sourceId);
  if (input.episodeId !== undefined)
    await assertEpisodeFits(db, source, input.episodeId);
  await db.update(mediaStreams).set(defined(input)).where(eq(mediaStreams.id, id)).run();
  await touchTitle(db, await titleOfSource(db, source));
  return await getStream(db, id);
}

export async function deleteStream(db: AppDatabase, id: string): Promise<StreamRow> {
  const current = await getStream(db, id);
  const source = await sourceRow(db, current.sourceId);
  await db.delete(mediaStreams).where(eq(mediaStreams.id, id)).run();
  await touchTitle(db, await titleOfSource(db, source));
  return current;
}

export interface PasteResult extends Alignment {
  /** Streams written. */
  readonly written: number;
  /** Episodes created for lines that had none (`createMissing`). */
  readonly created: number;
}

/**
 * Pasted `name$url` lines into a source. A season source lines them up with
 * its episodes (see `alignLines`), replacing each matched episode's streams
 * in this source; with `createMissing` an episode is added for a number the
 * season lacks. A movie source takes every line as one more stream. With
 * `dryRun` nothing is written: the admin previews the alignment first.
 */
export async function pasteStreams(
  db: AppDatabase,
  sourceId: string,
  text: string,
  options: { createMissing?: boolean | undefined; dryRun?: boolean | undefined } = {},
): Promise<PasteResult> {
  const source = await sourceRow(db, sourceId);
  const lines = parsePasted(text);
  if (lines.length === 0)
    throw new AppError("No name$url lines with an http(s) url found", 422, "NOTHING_PASTED");

  if (source.titleId !== null) {
    const alignment: Alignment = { matched: [], missing: [], unmatched: [] };
    if (options.dryRun)
      return { ...alignment, written: 0, created: 0 };
    await db.transaction(async (tx) => {
      const last = await tx.select({ sort: max(mediaStreams.sort) }).from(mediaStreams).where(and(eq(mediaStreams.sourceId, sourceId), isNull(mediaStreams.episodeId))).get();
      for (const [i, line] of lines.entries())
        await tx.insert(mediaStreams).values({ id: ulid(), sourceId, url: line.url, format: formatOf(line.url), resolution: line.name || null, sort: (last?.sort ?? -1) + 1 + i }).run();
    });
    await touchTitle(db, source.titleId);
    return { ...alignment, written: lines.length, created: 0 };
  }

  const seasonId = source.seasonId!;
  const episodes = await db.select({ id: mediaEpisodes.id, episodeNumber: mediaEpisodes.episodeNumber }).from(mediaEpisodes).where(eq(mediaEpisodes.seasonId, seasonId)).all();
  const alignment = alignLines(lines, episodes);
  if (options.dryRun)
    return { ...alignment, written: 0, created: 0 };

  const targets = alignment.matched.map(m => ({ episodeId: m.episodeId, line: m.line }));
  let created = 0;
  await db.transaction(async (tx) => {
    if (options.createMissing) {
      for (const m of alignment.missing) {
        const episodeId = ulid();
        await tx.insert(mediaEpisodes).values({ id: episodeId, seasonId, episodeNumber: m.episodeNumber }).run();
        targets.push({ episodeId, line: m.line });
        created++;
      }
    }
    for (const t of targets) {
      await tx.delete(mediaStreams).where(and(eq(mediaStreams.sourceId, sourceId), eq(mediaStreams.episodeId, t.episodeId))).run();
      await tx.insert(mediaStreams).values({ id: ulid(), sourceId, episodeId: t.episodeId, url: t.line.url, format: formatOf(t.line.url) }).run();
    }
  });
  if (targets.length > 0)
    await touchTitle(db, await titleOfSource(db, source));
  return { ...alignment, written: targets.length, created };
}
