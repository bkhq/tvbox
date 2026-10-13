import type { Library, ReadModel } from "./documents";
import type { ReadModelDb, RmStatement } from "./store";
import type { AppDatabase } from "@/db";
import { ulid } from "@/shared/lib/id";
import { LIVE_EPG_KEY } from "../live/live.service";
import {
  mediaCategories,
  mediaCollections,
  mediaCredits,
  mediaEpisodes,
  mediaExternalIds,
  mediaGenres,
  mediaImages,
  mediaLiveChannels,
  mediaLiveGroups,
  mediaLiveStreams,
  mediaPeople,
  mediaRowItems,
  mediaRows,
  mediaSeasons,
  mediaSources,
  mediaStreams,
  mediaTitleAliases,
  mediaTitleGenres,
  mediaTitles,
} from "../schema";
import { getHero, getSetting } from "../taxonomy/rows.service";
import { buildReadModel, hashOf } from "./documents";

// D1 runs a batch as one transaction; this many statements per call keeps a
// big rebuild to a few round trips without one huge request.
const BATCH = 400;

export interface ProjectResult {
  readonly generation: string;
  readonly upserted: number;
  readonly deleted: number;
  readonly titles: number;
}

/** Everything a publish reads. Whole tables: the library is small enough, and it spares 100-parameter `IN` lists. */
export async function loadLibrary(db: AppDatabase): Promise<Library> {
  return {
    categories: await db.select().from(mediaCategories).all(),
    genres: await db.select().from(mediaGenres).all(),
    collections: await db.select().from(mediaCollections).all(),
    titles: await db.select().from(mediaTitles).all(),
    aliases: await db.select().from(mediaTitleAliases).all(),
    titleGenres: await db.select().from(mediaTitleGenres).all(),
    seasons: await db.select().from(mediaSeasons).all(),
    episodes: await db.select().from(mediaEpisodes).all(),
    people: await db.select().from(mediaPeople).all(),
    credits: await db.select().from(mediaCredits).all(),
    images: await db.select().from(mediaImages).all(),
    externalIds: await db.select().from(mediaExternalIds).all(),
    sources: await db.select().from(mediaSources).all(),
    streams: await db.select().from(mediaStreams).all(),
    rows: await db.select().from(mediaRows).all(),
    rowItems: await db.select().from(mediaRowItems).all(),
    hero: await getHero(db),
    liveGroups: await db.select().from(mediaLiveGroups).all(),
    liveChannels: await db.select().from(mediaLiveChannels).all(),
    liveStreams: await db.select().from(mediaLiveStreams).all(),
    liveEpg: await getSetting<string[]>(db, LIVE_EPG_KEY, []),
  };
}

interface Plan {
  readonly statements: RmStatement[];
  upserted: number;
  deleted: number;
}

async function existingHashes(rm: ReadModelDb, sql: string): Promise<Map<string, string>> {
  const { results } = await rm.prepare(sql).all<{ id: string | number; hash: string }>();
  return new Map(results.map(r => [String(r.id), r.hash]));
}

/**
 * One table's diff: rows whose hash changed are rewritten (`write`), rows
 * no longer in the model removed (`remove`).
 */
async function diff<T>(
  rm: ReadModelDb,
  plan: Plan,
  existingSql: string,
  items: readonly T[],
  key: (item: T) => string,
  hash: (item: T) => string,
  write: (item: T, h: string, isNew: boolean) => RmStatement[],
  remove: (id: string) => RmStatement[],
): Promise<void> {
  const existing = await existingHashes(rm, existingSql);
  for (const item of items) {
    const id = key(item);
    const h = hash(item);
    const before = existing.get(id);
    existing.delete(id);
    if (before === h)
      continue;
    plan.statements.push(...write(item, h, before === undefined));
    plan.upserted++;
  }
  for (const id of existing.keys()) {
    plan.statements.push(...remove(id));
    plan.deleted++;
  }
}

const TABLES = ["rm_titles", "rm_title_genres", "rm_seasons", "rm_playback", "rm_people", "rm_collections", "rm_rows", "rm_row_items", "rm_search", "rm_cms_items", "rm_meta"];

/** Write `model` into the read model, touching only what changed (everything with `full`). */
export async function writeReadModel(rm: ReadModelDb, model: ReadModel, options: { full?: boolean } = {}): Promise<ProjectResult> {
  const plan: Plan = { statements: [], upserted: 0, deleted: 0 };
  const q = (sql: string, ...values: unknown[]) => rm.prepare(sql).bind(...values);

  if (options.full)
    await rm.batch(TABLES.map(t => rm.prepare(`DELETE FROM ${t}`)));

  await diff(rm, plan, "SELECT id, hash FROM rm_titles", model.titles, t => String(t.id), t => hashOf([t.card, t.detail, t.genreIds, t.manualSort, t.popularity]), (t, h, isNew) => [
    q(
      "INSERT OR REPLACE INTO rm_titles (id, type, category_id, year, country, language, rating, popularity, release_key, updated_at, manual_sort, card_json, detail_json, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      t.id,
      t.type,
      t.categoryId,
      t.year,
      t.country,
      t.language,
      t.rating,
      t.popularity,
      t.releaseKey,
      t.updatedAt,
      t.manualSort,
      JSON.stringify(t.card),
      JSON.stringify(t.detail),
      h,
    ),
    ...(isNew ? [] : [q("DELETE FROM rm_title_genres WHERE title_id = ?", t.id)]),
    ...t.genreIds.map(g => q("INSERT INTO rm_title_genres (genre_id, title_id) VALUES (?, ?)", g, t.id)),
  ], id => [q("DELETE FROM rm_titles WHERE id = ?", Number(id)), q("DELETE FROM rm_title_genres WHERE title_id = ?", Number(id))]);

  await diff(rm, plan, "SELECT id, hash FROM rm_seasons", model.seasons, s => String(s.id), s => hashOf(s.detail), (s, h) => [
    q("INSERT OR REPLACE INTO rm_seasons (id, title_id, number, detail_json, hash) VALUES (?, ?, ?, ?, ?)", s.id, s.titleId, s.number, JSON.stringify(s.detail), h),
  ], id => [q("DELETE FROM rm_seasons WHERE id = ?", Number(id))]);

  await diff(rm, plan, "SELECT id, hash FROM rm_playback", model.playback, p => p.id, p => hashOf(p.doc), (p, h) => [
    q("INSERT OR REPLACE INTO rm_playback (id, title_id, season_id, episode_number, json, hash) VALUES (?, ?, ?, ?, ?, ?)", p.id, p.titleId, p.seasonId, p.episodeNumber, JSON.stringify(p.doc), h),
  ], id => [q("DELETE FROM rm_playback WHERE id = ?", id)]);

  await diff(rm, plan, "SELECT id, hash FROM rm_people", model.people, p => String(p.id), p => hashOf(p.doc), (p, h) => [
    q("INSERT OR REPLACE INTO rm_people (id, json, hash) VALUES (?, ?, ?)", p.id, JSON.stringify(p.doc), h),
  ], id => [q("DELETE FROM rm_people WHERE id = ?", Number(id))]);

  await diff(rm, plan, "SELECT id, hash FROM rm_collections", model.collections, c => c.id, c => hashOf(c.doc), (c, h) => [
    q("INSERT OR REPLACE INTO rm_collections (id, json, hash) VALUES (?, ?, ?)", c.id, JSON.stringify(c.doc), h),
  ], id => [q("DELETE FROM rm_collections WHERE id = ?", id)]);

  await diff(rm, plan, "SELECT id, hash FROM rm_rows", model.rows, r => r.id, r => hashOf(r), (r, h, isNew) => [
    q("INSERT OR REPLACE INTO rm_rows (id, sort, name, hash) VALUES (?, ?, ?, ?)", r.id, r.sort, r.name, h),
    ...(isNew ? [] : [q("DELETE FROM rm_row_items WHERE row_id = ?", r.id)]),
    ...r.titleIds.map((titleId, i) => q("INSERT INTO rm_row_items (row_id, sort, title_id) VALUES (?, ?, ?)", r.id, i, titleId)),
  ], id => [q("DELETE FROM rm_rows WHERE id = ?", id), q("DELETE FROM rm_row_items WHERE row_id = ?", id)]);

  await diff(rm, plan, "SELECT ref AS id, hash FROM rm_search", model.search, s => s.ref, s => hashOf(s.text), (s, h, isNew) => [
    ...(isNew ? [] : [q("DELETE FROM rm_search WHERE ref = ?", s.ref)]),
    q("INSERT INTO rm_search (ref, hash, text) VALUES (?, ?, ?)", s.ref, h, s.text),
  ], id => [q("DELETE FROM rm_search WHERE ref = ?", id)]);

  await diff(rm, plan, "SELECT vod_id AS id, hash FROM rm_cms_items", model.cmsItems, c => c.vodId, c => hashOf(c), (c, h) => [
    q(
      "INSERT OR REPLACE INTO rm_cms_items (vod_id, title_id, season_id, type_id, year, country, genres, updated_at, group_order, list_json, detail_json, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      c.vodId,
      c.titleId,
      c.seasonId,
      c.typeId,
      c.year,
      c.country,
      c.genres,
      c.updatedAt,
      c.groupOrder,
      JSON.stringify(c.list),
      JSON.stringify(c.detail),
      h,
    ),
  ], id => [q("DELETE FROM rm_cms_items WHERE vod_id = ?", id)]);

  const meta = Object.entries(model.meta).map(([key, value]) => ({ key, value: JSON.stringify(value) }));
  await diff(rm, plan, "SELECT key AS id, value AS hash FROM rm_meta WHERE key <> 'generation'", meta, m => m.key, m => m.value, m => [
    q("INSERT OR REPLACE INTO rm_meta (key, value) VALUES (?, ?)", m.key, m.value),
  ], id => [q("DELETE FROM rm_meta WHERE key = ?", id)]);

  // The generation goes last, so a client that sees it sees everything before it.
  const generation = ulid();
  plan.statements.push(q("INSERT OR REPLACE INTO rm_meta (key, value) VALUES ('generation', ?)", generation));
  for (let i = 0; i < plan.statements.length; i += BATCH)
    await rm.batch(plan.statements.slice(i, i + BATCH));

  return { generation, upserted: plan.upserted, deleted: plan.deleted, titles: model.titles.length };
}

/** Today in UTC, the day episodes and releases are gated by. */
export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Publish the library: project what is published now into the read model. */
export async function projectLibrary(db: AppDatabase, rm: ReadModelDb, options: { full?: boolean; today?: string } = {}): Promise<ProjectResult> {
  const model = buildReadModel(await loadLibrary(db), options.today ?? today());
  return await writeReadModel(rm, model, options);
}
