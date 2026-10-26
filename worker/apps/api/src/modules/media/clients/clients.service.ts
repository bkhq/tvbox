import type { MediaDb } from "../db";
import { createHash, randomBytes } from "node:crypto";
import { count, eq, inArray, max } from "drizzle-orm";
import { AppError, isUniqueViolation, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { insertRows, runBatch } from "../db";
import { mediaChannels, mediaClientChannels, mediaClients, mediaTitleChannels } from "../schema";

type ChannelRow = typeof mediaChannels.$inferSelect;
type ClientRow = typeof mediaClients.$inferSelect;

export interface ChannelView extends ChannelRow {
  readonly titleCount: number;
  readonly clientCount: number;
}

export interface ClientView extends Omit<ClientRow, "tokenHash"> {
  readonly channelIds: string[];
}

export interface ClientInput {
  readonly name: string;
  readonly note?: string | undefined;
  readonly enabled?: boolean | undefined;
  readonly channelIds: readonly string[];
}

// ─── Channels ───

export async function listChannels(db: MediaDb): Promise<ChannelView[]> {
  const rows = await db.select().from(mediaChannels).orderBy(mediaChannels.sort, mediaChannels.id).all();
  const titles = await db.select({
    id: mediaTitleChannels.channelId,
    n: count(),
  }).from(mediaTitleChannels).groupBy(mediaTitleChannels.channelId).all();
  const clients = await db.select({
    id: mediaClientChannels.channelId,
    n: count(),
  }).from(mediaClientChannels).groupBy(mediaClientChannels.channelId).all();
  return rows.map(r => ({
    ...r,
    titleCount: titles.find(t => t.id === r.id)?.n ?? 0,
    clientCount: clients.find(c => c.id === r.id)?.n ?? 0,
  }));
}

async function getChannel(db: MediaDb, id: string): Promise<ChannelView> {
  const row = (await listChannels(db)).find(c => c.id === id);
  if (!row)
    throw new NotFoundError("Channel", id);
  return row;
}

async function guardChannelName<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  }
  catch (err) {
    if (isUniqueViolation(err))
      throw new AppError("A channel with this name already exists", 409, "CHANNEL_EXISTS");
    throw err;
  }
}

export async function createChannel(db: MediaDb, input: { name: string }): Promise<ChannelView> {
  const id = ulid();
  const last = await db.select({
    sort: max(mediaChannels.sort),
  }).from(mediaChannels).get();
  await guardChannelName(() => db.insert(mediaChannels).values({ id, name: input.name, sort: (last?.sort ?? -1) + 1 }).run());
  return await getChannel(db, id);
}

export async function updateChannel(db: MediaDb, id: string, patch: { name?: string | undefined }): Promise<ChannelView> {
  await getChannel(db, id);
  if (patch.name !== undefined) {
    await guardChannelName(() => db.update(mediaChannels).set({
      name: patch.name!,
      updatedAt: new Date().toISOString(),
    }).where(eq(mediaChannels.id, id)).run());
  }
  return await getChannel(db, id);
}

export async function reorderChannels(db: MediaDb, ids: readonly string[]): Promise<void> {
  await runBatch(db, ids.map((id, i) => db.update(mediaChannels).set({ sort: i }).where(eq(mediaChannels.id, id))));
}

/** Titles lose the channel; a client whose only channel it is blocks the delete. */
export async function deleteChannel(db: MediaDb, id: string): Promise<ChannelView> {
  const row = await getChannel(db, id);
  const holders = await db.select({ clientId: mediaClientChannels.clientId }).from(mediaClientChannels).where(eq(mediaClientChannels.channelId, id)).all();
  if (holders.length > 0) {
    const links = await db.select({
      clientId: mediaClientChannels.clientId,
      n: count(),
    }).from(mediaClientChannels).where(inArray(mediaClientChannels.clientId, holders.map(h => h.clientId))).groupBy(mediaClientChannels.clientId).all();
    if (links.some(l => l.n <= 1))
      throw new AppError("The channel is the only channel of a client", 409, "CHANNEL_IN_USE");
  }
  await db.delete(mediaChannels).where(eq(mediaChannels.id, id)).run();
  return row;
}

async function assertClientChannels(db: MediaDb, ids: readonly string[]): Promise<string[]> {
  const unique = [
    ...new Set(ids),
  ];
  if (unique.length === 0)
    throw new AppError("A client needs at least one channel", 422, "CHANNEL_REQUIRED");
  const found = await db.select({ id: mediaChannels.id }).from(mediaChannels).where(inArray(mediaChannels.id, unique)).all();
  const missing = unique.find(id => !found.some(f => f.id === id));
  if (missing)
    throw new NotFoundError("Channel", missing);
  return unique;
}

// ─── Clients ───

function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(16).toString("hex");
  return {
    token,
    tokenHash: createHash("sha256").update(token).digest("hex"),
  };
}

async function viewsOf(db: MediaDb, rows: readonly ClientRow[]): Promise<ClientView[]> {
  const links = rows.length > 0
    ? await db.select().from(mediaClientChannels).where(inArray(mediaClientChannels.clientId, rows.map(r => r.id))).all()
    : [];
  return rows.map(({ tokenHash: _, ...r }) => ({
    ...r,
    channelIds: links.filter(l => l.clientId === r.id).map(l => l.channelId),
  }));
}

export async function listClients(db: MediaDb): Promise<ClientView[]> {
  return await viewsOf(db, await db.select().from(mediaClients).orderBy(mediaClients.createdAt, mediaClients.id).all());
}

export async function getClient(db: MediaDb, id: string): Promise<ClientView> {
  const row = await db.select().from(mediaClients).where(eq(mediaClients.id, id)).get();
  if (!row)
    throw new NotFoundError("Client", id);
  return (await viewsOf(db, [row]))[0]!;
}

export async function createClient(db: MediaDb, input: ClientInput): Promise<ClientView> {
  const channelIds = await assertClientChannels(db, input.channelIds);
  const id = ulid();
  await runBatch(db, [
    db.insert(mediaClients).values({
      id,
      name: input.name,
      note: input.note ?? "",
      enabled: input.enabled ?? true,
      ...newToken(),
    }),
    ...insertRows(db, mediaClientChannels, channelIds.map(channelId => ({ clientId: id, channelId }))),
  ]);
  return await getClient(db, id);
}

export type ClientPatch = { [K in keyof ClientInput]?: ClientInput[K] | undefined };

export async function updateClient(db: MediaDb, id: string, patch: ClientPatch): Promise<ClientView> {
  await getClient(db, id);
  const channelIds = patch.channelIds !== undefined
    ? await assertClientChannels(db, patch.channelIds)
    : undefined;
  await runBatch(db, [
    db.update(mediaClients).set({
      ...(patch.name !== undefined
        ? { name: patch.name }
        : {}),
      ...(patch.note !== undefined
        ? { note: patch.note }
        : {}),
      ...(patch.enabled !== undefined
        ? { enabled: patch.enabled }
        : {}),
      updatedAt: new Date().toISOString(),
    }).where(eq(mediaClients.id, id)),
    ...(channelIds
      ? [
          db.delete(mediaClientChannels).where(eq(mediaClientChannels.clientId, id)),
          ...insertRows(db, mediaClientChannels, channelIds.map(channelId => ({ clientId: id, channelId }))),
        ]
      : []),
  ]);
  return await getClient(db, id);
}

/** The old URL stops working. */
export async function rotateClientToken(db: MediaDb, id: string): Promise<ClientView> {
  await getClient(db, id);
  await db.update(mediaClients).set({
    ...newToken(),
    updatedAt: new Date().toISOString(),
  }).where(eq(mediaClients.id, id)).run();
  return await getClient(db, id);
}

export async function deleteClient(db: MediaDb, id: string): Promise<ClientView> {
  const row = await getClient(db, id);
  await db.delete(mediaClients).where(eq(mediaClients.id, id)).run();
  return row;
}
