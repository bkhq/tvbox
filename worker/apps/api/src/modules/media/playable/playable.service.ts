import type { MediaDb, Statement } from "../db";
import type { Alignment } from "./align";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { touchTitle } from "../catalog/titles.service";
import { runBatch } from "../db";
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
async function titleOfSource(db: MediaDb, source: SourceRow): Promise<string> {
  if (source.titleId !== null)
    return source.titleId;
  const season = await db.select({ titleId: mediaSeasons.titleId }).from(mediaSeasons).where(eq(mediaSeasons.id, source.seasonId!)).get();
  return season!.titleId;
}

/** The episodes (`""` for the movie) a source's owner can play: those with a stream on an enabled line. */
async function playableKeys(db: MediaDb, source: SourceRow): Promise<Set<string>> {
  const owner = source.titleId !== null
    ? eq(mediaSources.titleId, source.titleId)
    : eq(mediaSources.seasonId, source.seasonId!);
  const rows = await db.selectDistinct({ episodeId: mediaStreams.episodeId })
    .from(mediaStreams)
    .innerJoin(mediaSources, eq(mediaStreams.sourceId, mediaSources.id))
    .where(and(owner, eq(mediaSources.enabled, true)))
    .all();
  return new Set(rows.map(r => r.episodeId ?? ""));
}

/**
 * Runs a write to lines or streams and moves the title's `updatedAt` only
 * when it made an episode (or the movie) newly playable. Adding a line or
 * swapping a url leaves the metadata alone: the title is not "updated" and
 * only its playback is republished.
 */
async function touchIfNewlyPlayable<T>(db: MediaDb, source: SourceRow, write: () => Promise<T>): Promise<T> {
  const before = await playableKeys(db, source);
  const result = await write();
  const after = await playableKeys(db, source);
  if ([...after].some(key => !before.has(key)))
    await touchTitle(db, await titleOfSource(db, source));
  return result;
}

// ─── Sources ───

async function sourceRow(db: MediaDb, id: string): Promise<SourceRow> {
  const row = await db.select().from(mediaSources).where(eq(mediaSources.id, id)).get();
  if (!row)
    throw new NotFoundError("Source", id);
  return row;
}

export async function getSource(db: MediaDb, id: string): Promise<SourceView> {
  const row = await sourceRow(db, id);
  const streams = await db.select({ id: mediaStreams.id }).from(mediaStreams).where(eq(mediaStreams.sourceId, id)).all();
  return { ...row, streamCount: streams.length };
}

/** A movie's sources, or a season's. */
export async function listSources(db: MediaDb, owner: { titleId: string } | { seasonId: string }): Promise<SourceView[]> {
  const where = "titleId" in owner
    ? eq(mediaSources.titleId, owner.titleId)
    : eq(mediaSources.seasonId, owner.seasonId);
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
  db: MediaDb,
  owner: { titleId: string } | { seasonId: string },
  input: { name: string; quality?: string | null | undefined; enabled?: boolean | undefined },
): Promise<SourceView> {
  if ("titleId" in owner) {
    const title = await db.select({ kind: mediaTitles.kind }).from(mediaTitles).where(eq(mediaTitles.id, owner.titleId)).get();
    if (!title)
      throw new NotFoundError("Title", String(owner.titleId));
    if (title.kind !== "movie")
      throw new AppError("A series' sources belong to its seasons", 422, "SOURCE_OWNER_MISMATCH");
  }
  else {
    const season = await db.select({ id: mediaSeasons.id }).from(mediaSeasons).where(eq(mediaSeasons.id, owner.seasonId)).get();
    if (!season)
      throw new NotFoundError("Season", String(owner.seasonId));
  }
  const where = "titleId" in owner
    ? eq(mediaSources.titleId, owner.titleId)
    : eq(mediaSources.seasonId, owner.seasonId);
  const last = await db.select({
    sort: max(mediaSources.sort),
  }).from(mediaSources).where(where).get();
  const id = ulid();
  await db.insert(mediaSources).values({
    id,
    titleId: "titleId" in owner
      ? owner.titleId
      : null,
    seasonId: "seasonId" in owner
      ? owner.seasonId
      : null,
    name: input.name,
    quality: input.quality ?? null,
    enabled: input.enabled ?? true,
    sort: (last?.sort ?? -1) + 1,
  }).run();
  return await getSource(db, id);
}

export async function updateSource(db: MediaDb, id: string, patch: { name?: string | undefined; quality?: string | null | undefined; enabled?: boolean | undefined }): Promise<SourceView> {
  const row = await sourceRow(db, id);
  await touchIfNewlyPlayable(db, row, async () =>
    await db.update(mediaSources).set({
      ...defined(patch),
      updatedAt: new Date().toISOString(),
    }).where(eq(mediaSources.id, id)).run());
  return await getSource(db, id);
}

export async function deleteSource(db: MediaDb, id: string): Promise<SourceView> {
  const current = await getSource(db, id);
  await db.delete(mediaSources).where(eq(mediaSources.id, id)).run();
  return current;
}

export async function reorderSources(db: MediaDb, ids: readonly string[]): Promise<void> {
  await runBatch(db, ids.map((id, i) => db.update(mediaSources).set({ sort: i }).where(eq(mediaSources.id, id))));
}

// ─── Streams ───

export async function listStreams(db: MediaDb, sourceId: string): Promise<StreamRow[]> {
  await sourceRow(db, sourceId);
  return await db.select().from(mediaStreams).where(eq(mediaStreams.sourceId, sourceId)).orderBy(asc(mediaStreams.episodeId), asc(mediaStreams.sort), asc(mediaStreams.id)).all();
}

async function getStream(db: MediaDb, id: string): Promise<StreamRow> {
  const row = await db.select().from(mediaStreams).where(eq(mediaStreams.id, id)).get();
  if (!row)
    throw new NotFoundError("Stream", id);
  return row;
}

/** A movie source's streams have no episode; a season source's need one of that season. */
async function assertEpisodeFits(db: MediaDb, source: SourceRow, episodeId: string | null | undefined): Promise<void> {
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

export async function addStream(db: MediaDb, sourceId: string, input: StreamInput & { url: string }): Promise<StreamRow> {
  const source = await sourceRow(db, sourceId);
  await assertEpisodeFits(db, source, input.episodeId);
  const id = ulid();
  await touchIfNewlyPlayable(db, source, async () =>
    await db.insert(mediaStreams).values({
      ...defined(input),
      id,
      sourceId,
      url: input.url,
      format: input.format ?? formatOf(input.url),
    }).run());
  return await getStream(db, id);
}

export async function updateStream(db: MediaDb, id: string, input: StreamInput): Promise<StreamRow> {
  const current = await getStream(db, id);
  const source = await sourceRow(db, current.sourceId);
  if (input.episodeId !== undefined)
    await assertEpisodeFits(db, source, input.episodeId);
  await touchIfNewlyPlayable(db, source, async () =>
    await db.update(mediaStreams).set(defined(input)).where(eq(mediaStreams.id, id)).run());
  return await getStream(db, id);
}

export async function deleteStream(db: MediaDb, id: string): Promise<StreamRow> {
  const current = await getStream(db, id);
  await db.delete(mediaStreams).where(eq(mediaStreams.id, id)).run();
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
  db: MediaDb,
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
    const last = await db.select({
      sort: max(mediaStreams.sort),
    }).from(mediaStreams).where(and(eq(mediaStreams.sourceId, sourceId), isNull(mediaStreams.episodeId))).get();
    await touchIfNewlyPlayable(db, source, async () => await runBatch(db, lines.map((line, i) =>
      db.insert(mediaStreams).values({
        id: ulid(),
        sourceId,
        url: line.url,
        format: formatOf(line.url),
        resolution: line.name || null,
        sort: (last?.sort ?? -1) + 1 + i,
      }))));
    return { ...alignment, written: lines.length, created: 0 };
  }

  const seasonId = source.seasonId!;
  const episodes = await db.select({ id: mediaEpisodes.id, episodeNumber: mediaEpisodes.episodeNumber }).from(mediaEpisodes).where(eq(mediaEpisodes.seasonId, seasonId)).all();
  const alignment = alignLines(lines, episodes);
  if (options.dryRun)
    return { ...alignment, written: 0, created: 0 };

  const targets = alignment.matched.map(m => ({ episodeId: m.episodeId, line: m.line }));
  const statements: Statement[] = [];
  let created = 0;
  if (options.createMissing) {
    for (const m of alignment.missing) {
      const episodeId = ulid();
      statements.push(db.insert(mediaEpisodes).values({ id: episodeId, seasonId, episodeNumber: m.episodeNumber }));
      targets.push({ episodeId, line: m.line });
      created++;
    }
  }
  for (const t of targets) {
    statements.push(
      db.delete(mediaStreams).where(and(eq(mediaStreams.sourceId, sourceId), eq(mediaStreams.episodeId, t.episodeId))),
      db.insert(mediaStreams).values({
        id: ulid(),
        sourceId,
        episodeId: t.episodeId,
        url: t.line.url,
        format: formatOf(t.line.url),
      }),
    );
  }
  await touchIfNewlyPlayable(db, source, async () => await runBatch(db, statements));
  return { ...alignment, written: targets.length, created };
}
