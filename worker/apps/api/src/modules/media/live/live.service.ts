import type { Live } from "../contract";
import type { MediaDb, Statement } from "../db";
import type { M3uChannel } from "./m3u";
import { asc, count, eq, inArray, max } from "drizzle-orm";
import { chunked } from "@/shared/lib/chunk";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { insertRows, runBatch } from "../db";
import { mediaLiveChannels, mediaLiveGroups, mediaLiveStreams } from "../schema";
import { buildLive } from "../serve/documents";
import { getSetting, putSetting } from "../taxonomy/rows.service";
import { parseM3u, toM3u } from "./m3u";

type GroupRow = typeof mediaLiveGroups.$inferSelect;
type ChannelRow = typeof mediaLiveChannels.$inferSelect;
type StreamRow = typeof mediaLiveStreams.$inferSelect;

export const LIVE_EPG_KEY = "live_epg_urls";
const MAX_CHANNELS = 5000;

export interface GroupView extends GroupRow {
  readonly channelCount: number;
}

export interface StreamInput {
  readonly url: string;
  readonly label?: string | null | undefined;
  readonly userAgent?: string | null | undefined;
  readonly referer?: string | null | undefined;
}

export interface ChannelView extends ChannelRow {
  readonly streams: Omit<StreamRow, "channelId">[];
}

export interface ChannelInput {
  readonly groupId?: string | undefined;
  readonly name?: string | undefined;
  readonly number?: number | null | undefined;
  readonly tvgId?: string | null | undefined;
  readonly logo?: string | null | undefined;
  readonly enabled?: boolean | undefined;
  /** Replaces the channel's streams, in order. */
  readonly streams?: readonly StreamInput[] | undefined;
}

// ─── Groups ───

export async function listGroups(db: MediaDb): Promise<GroupView[]> {
  const rows = await db.select().from(mediaLiveGroups).orderBy(asc(mediaLiveGroups.sort), asc(mediaLiveGroups.id)).all();
  const counts = await db.select({
    id: mediaLiveChannels.groupId,
    n: count(),
  }).from(mediaLiveChannels).groupBy(mediaLiveChannels.groupId).all();
  return rows.map(r => ({ ...r, channelCount: counts.find(c => c.id === r.id)?.n ?? 0 }));
}

async function groupRow(db: MediaDb, id: string): Promise<GroupRow> {
  const row = await db.select().from(mediaLiveGroups).where(eq(mediaLiveGroups.id, id)).get();
  if (!row)
    throw new NotFoundError("Live group", id);
  return row;
}

async function nextGroupSort(db: MediaDb): Promise<number> {
  const last = await db.select({
    sort: max(mediaLiveGroups.sort),
  }).from(mediaLiveGroups).get();
  return (last?.sort ?? -1) + 1;
}

export async function createGroup(db: MediaDb, name: string): Promise<GroupRow> {
  const row = {
    id: ulid(),
    name,
    sort: await nextGroupSort(db),
  };
  await db.insert(mediaLiveGroups).values(row).run();
  return row;
}

export async function updateGroup(db: MediaDb, id: string, name: string): Promise<GroupRow> {
  await groupRow(db, id);
  await db.update(mediaLiveGroups).set({ name }).where(eq(mediaLiveGroups.id, id)).run();
  return await groupRow(db, id);
}

/** Deletes its channels and their streams too. */
export async function deleteGroup(db: MediaDb, id: string): Promise<GroupRow> {
  const current = await groupRow(db, id);
  const channels = await db.select({ id: mediaLiveChannels.id }).from(mediaLiveChannels).where(eq(mediaLiveChannels.groupId, id)).all();
  await runBatch(db, [
    ...chunked(channels.map(c => c.id)).map(part => db.delete(mediaLiveStreams).where(inArray(mediaLiveStreams.channelId, part))),
    db.delete(mediaLiveChannels).where(eq(mediaLiveChannels.groupId, id)),
    db.delete(mediaLiveGroups).where(eq(mediaLiveGroups.id, id)),
  ]);
  return current;
}

export async function reorderGroups(db: MediaDb, ids: readonly string[]): Promise<void> {
  await runBatch(db, ids.map((id, i) => db.update(mediaLiveGroups).set({ sort: i }).where(eq(mediaLiveGroups.id, id))));
}

// ─── Channels ───

async function viewsOf(db: MediaDb, rows: readonly ChannelRow[]): Promise<ChannelView[]> {
  const streams: StreamRow[] = [];
  for (const part of chunked(rows.map(r => r.id)))
    streams.push(...await db.select().from(mediaLiveStreams).where(inArray(mediaLiveStreams.channelId, part)).all());
  return rows.map(r => ({
    ...r,
    streams: streams.filter(s => s.channelId === r.id).sort((a, b) => a.sort - b.sort).map(({ channelId: _, ...s }) => s),
  }));
}

export async function getChannel(db: MediaDb, id: string): Promise<ChannelView> {
  const row = await db.select().from(mediaLiveChannels).where(eq(mediaLiveChannels.id, id)).get();
  if (!row)
    throw new NotFoundError("Live channel", id);
  return (await viewsOf(db, [row]))[0]!;
}

export async function listChannels(db: MediaDb, groupId: string): Promise<ChannelView[]> {
  await groupRow(db, groupId);
  const rows = await db.select().from(mediaLiveChannels).where(eq(mediaLiveChannels.groupId, groupId)).orderBy(asc(mediaLiveChannels.sort), asc(mediaLiveChannels.id)).all();
  return await viewsOf(db, rows);
}

function writeStreams(db: MediaDb, channelId: string, streams: readonly StreamInput[]): Statement[] {
  const rows = streams.map((s, sort) => ({
    id: ulid(),
    channelId,
    url: s.url,
    label: s.label ?? null,
    userAgent: s.userAgent ?? null,
    referer: s.referer ?? null,
    sort,
  }));
  return [
    db.delete(mediaLiveStreams).where(eq(mediaLiveStreams.channelId, channelId)),
    ...insertRows(db, mediaLiveStreams, rows),
  ];
}

export async function createChannel(db: MediaDb, input: ChannelInput & { groupId: string; name: string }): Promise<ChannelView> {
  await groupRow(db, input.groupId);
  const last = await db.select({
    sort: max(mediaLiveChannels.sort),
  }).from(mediaLiveChannels).where(eq(mediaLiveChannels.groupId, input.groupId)).get();
  const id = ulid();
  await runBatch(db, [
    db.insert(mediaLiveChannels).values({
      id,
      groupId: input.groupId,
      name: input.name,
      number: input.number ?? null,
      tvgId: input.tvgId ?? null,
      logo: input.logo ?? null,
      enabled: input.enabled ?? true,
      sort: (last?.sort ?? -1) + 1,
    }),
    ...writeStreams(db, id, input.streams ?? []),
  ]);
  return await getChannel(db, id);
}

export async function updateChannel(db: MediaDb, id: string, input: ChannelInput): Promise<ChannelView> {
  await getChannel(db, id);
  if (input.groupId !== undefined)
    await groupRow(db, input.groupId);
  const { streams, ...fields } = input;
  const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  await runBatch(db, [
    ...(Object.keys(set).length > 0
      ? [
          db.update(mediaLiveChannels).set(set).where(eq(mediaLiveChannels.id, id)),
        ]
      : []),
    ...(streams
      ? writeStreams(db, id, streams)
      : []),
  ]);
  return await getChannel(db, id);
}

export async function deleteChannel(db: MediaDb, id: string): Promise<ChannelView> {
  const current = await getChannel(db, id);
  await runBatch(db, [
    db.delete(mediaLiveStreams).where(eq(mediaLiveStreams.channelId, id)),
    db.delete(mediaLiveChannels).where(eq(mediaLiveChannels.id, id)),
  ]);
  return current;
}

export async function reorderChannels(db: MediaDb, ids: readonly string[]): Promise<void> {
  await runBatch(db, ids.map((id, i) => db.update(mediaLiveChannels).set({ sort: i }).where(eq(mediaLiveChannels.id, id))));
}

// ─── EPG ───

export async function getEpg(db: MediaDb): Promise<string[]> {
  return await getSetting<string[]>(db, LIVE_EPG_KEY, []);
}

export async function setEpg(db: MediaDb, urls: readonly string[]): Promise<string[]> {
  const unique = [
    ...new Set(urls),
  ];
  await putSetting(db, LIVE_EPG_KEY, unique);
  return unique;
}

// ─── M3U ───

export interface ImportResult {
  readonly groups: number;
  readonly channels: number;
  readonly streams: number;
  /** Streams already on their channel, not added again. */
  readonly skipped: number;
}

/**
 * Copy a playlist into the tables, once: it is not a subscription. Channels
 * are matched by group and name, so several lines of one channel become its
 * streams, and importing the same playlist again adds nothing. `replace`
 * clears every group first.
 */
export async function importM3u(db: MediaDb, text: string, options: { replace?: boolean | undefined; dryRun?: boolean | undefined } = {}): Promise<ImportResult> {
  const playlist = parseM3u(text);
  if (playlist.channels.length === 0)
    throw new AppError("No channels found in the playlist", 422, "NOTHING_IMPORTED");

  const byKey = new Map<string, { group: string; first: M3uChannel; streams: StreamInput[] }>();
  for (const c of playlist.channels) {
    const key = `${c.group}\u0000${c.name}`;
    const entry = byKey.get(key) ?? { group: c.group, first: c, streams: [] };
    if (!entry.streams.some(s => s.url === c.url))
      entry.streams.push({ url: c.url, userAgent: c.userAgent, referer: c.referer });
    byKey.set(key, entry);
  }
  if (byKey.size > MAX_CHANNELS)
    throw new AppError(`A playlist holds at most ${MAX_CHANNELS} channels`, 422, "PLAYLIST_TOO_LONG");

  const groups = new Map((options.replace
    ? []
    : await db.select().from(mediaLiveGroups).all()).map(g => [g.name, g]));
  const channels = new Map((options.replace
    ? []
    : await db.select().from(mediaLiveChannels).all()).map(c => [`${c.groupId}\u0000${c.name}`, c]));
  const existingStreams = options.replace
    ? []
    : await db.select({ channelId: mediaLiveStreams.channelId, url: mediaLiveStreams.url }).from(mediaLiveStreams).all();
  const present = new Set(existingStreams.map(s => `${s.channelId}\u0000${s.url}`));

  let skipped = 0;
  const groupRows: GroupRow[] = [];
  const channelRows: ChannelRow[] = [];
  const streamRows: StreamRow[] = [];
  let groupSort = Math.max(-1, ...[
    ...groups.values(),
  ].map(g => g.sort));
  const channelSort = new Map<string, number>();
  for (const c of channels.values())
    channelSort.set(c.groupId, Math.max(channelSort.get(c.groupId) ?? -1, c.sort));
  const streamCount = new Map<string, number>();
  for (const s of existingStreams)
    streamCount.set(s.channelId, (streamCount.get(s.channelId) ?? 0) + 1);

  for (const { group: groupName, first, streams } of byKey.values()) {
    let group = groups.get(groupName);
    if (!group) {
      group = {
        id: ulid(),
        name: groupName,
        sort: ++groupSort,
      };
      groups.set(groupName, group);
      groupRows.push(group);
    }
    const channelKey = `${group.id}\u0000${first.name}`;
    let channel = channels.get(channelKey);
    if (!channel) {
      const sort = (channelSort.get(group.id) ?? -1) + 1;
      channelSort.set(group.id, sort);
      channel = {
        id: ulid(),
        groupId: group.id,
        name: first.name,
        number: first.number,
        tvgId: first.tvgId,
        logo: first.logo,
        enabled: true,
        sort,
      };
      channels.set(channelKey, channel);
      channelRows.push(channel);
    }
    for (const s of streams) {
      if (present.has(`${channel.id}\u0000${s.url}`)) {
        skipped++;
        continue;
      }
      const sort = streamCount.get(channel.id) ?? 0;
      streamCount.set(channel.id, sort + 1);
      streamRows.push({
        id: ulid(),
        channelId: channel.id,
        url: s.url,
        label: null,
        userAgent: s.userAgent ?? null,
        referer: s.referer ?? null,
        sort,
      });
    }
  }

  if (!options.dryRun) {
    await runBatch(db, [
      ...(options.replace
        ? [
            db.delete(mediaLiveStreams),
            db.delete(mediaLiveChannels),
            db.delete(mediaLiveGroups),
          ]
        : []),
      ...insertRows(db, mediaLiveGroups, groupRows),
      ...insertRows(db, mediaLiveChannels, channelRows),
      ...insertRows(db, mediaLiveStreams, streamRows),
    ]);
    if (playlist.epg.length > 0 && (options.replace || (await getEpg(db)).length === 0))
      await setEpg(db, playlist.epg);
  }
  return {
    groups: groupRows.length,
    channels: channelRows.length,
    streams: streamRows.length,
    skipped,
  };
}

/** The enabled channels as M3U, as they would be published. */
/** The enabled channels with streams, grouped. */
export async function loadLive(db: MediaDb): Promise<Live> {
  return buildLive({
    liveGroups: await db.select().from(mediaLiveGroups).all(),
    liveChannels: await db.select().from(mediaLiveChannels).all(),
    liveStreams: await db.select().from(mediaLiveStreams).all(),
    liveEpg: await getEpg(db),
  });
}

export async function exportM3u(db: MediaDb): Promise<string> {
  return toM3u(await loadLive(db));
}
