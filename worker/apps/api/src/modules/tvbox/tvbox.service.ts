import type { JsonObject, ListKind } from "./parse";
import type { AppDatabase } from "@/db";
import { and, eq, inArray, max, ne } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { tvboxEntries, tvboxGlobals, tvboxUpstreams } from "./schema";

export type UpstreamRow = typeof tvboxUpstreams.$inferSelect;
type EntryRow = typeof tvboxEntries.$inferSelect;
type GlobalRow = typeof tvboxGlobals.$inferSelect;

export interface EntryView extends Omit<EntryRow, "data" | "upstreamData"> {
  readonly data: JsonObject;
  readonly upstreamData: JsonObject | null;
}

export interface GlobalView extends Omit<GlobalRow, "value" | "upstreamValue"> {
  readonly value: unknown;
  readonly upstreamValue: unknown;
}

function entryView(row: EntryRow): EntryView {
  return {
    ...row,
    data: JSON.parse(row.data) as JsonObject,
    upstreamData: row.upstreamData === null ? null : JSON.parse(row.upstreamData) as JsonObject,
  };
}

function globalView(row: GlobalRow): GlobalView {
  return {
    ...row,
    value: JSON.parse(row.value) as unknown,
    upstreamValue: row.upstreamValue === null ? null : JSON.parse(row.upstreamValue) as unknown,
  };
}

// ─── Upstreams ───

export async function listUpstreams(db: AppDatabase): Promise<UpstreamRow[]> {
  return await db.select().from(tvboxUpstreams).orderBy(tvboxUpstreams.id).all();
}

export async function getUpstream(db: AppDatabase, id: string): Promise<UpstreamRow> {
  const row = await db.select().from(tvboxUpstreams).where(eq(tvboxUpstreams.id, id)).get();
  if (!row)
    throw new NotFoundError("Upstream");
  return row;
}

/** The first upstream becomes primary. */
export async function createUpstream(db: AppDatabase, input: { name: string; url: string; syncEnabled?: boolean | undefined }): Promise<UpstreamRow> {
  const id = ulid();
  const hasPrimary = await db.select({ id: tvboxUpstreams.id }).from(tvboxUpstreams).where(eq(tvboxUpstreams.isPrimary, true)).get();
  await db.insert(tvboxUpstreams).values({
    id,
    name: input.name,
    url: input.url,
    isPrimary: !hasPrimary,
    syncEnabled: input.syncEnabled ?? true,
  }).run();
  return await getUpstream(db, id);
}

export async function updateUpstream(
  db: AppDatabase,
  id: string,
  patch: { name?: string | undefined; url?: string | undefined; syncEnabled?: boolean | undefined; isPrimary?: true | undefined },
): Promise<UpstreamRow> {
  await getUpstream(db, id);
  await db.transaction(async (tx) => {
    if (patch.isPrimary)
      await tx.update(tvboxUpstreams).set({ isPrimary: false }).where(ne(tvboxUpstreams.id, id)).run();
    await tx.update(tvboxUpstreams).set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.url !== undefined ? { url: patch.url } : {}),
      ...(patch.syncEnabled !== undefined ? { syncEnabled: patch.syncEnabled } : {}),
      ...(patch.isPrimary ? { isPrimary: true } : {}),
      updatedAt: new Date().toISOString(),
    }).where(eq(tvboxUpstreams.id, id)).run();
  });
  return await getUpstream(db, id);
}

/** Its entries go with it; globals it supplied stay, they are ours now. */
export async function deleteUpstream(db: AppDatabase, id: string): Promise<UpstreamRow> {
  const row = await getUpstream(db, id);
  await db.delete(tvboxUpstreams).where(eq(tvboxUpstreams.id, id)).run();
  return row;
}

// ─── Entries ───

const IDENTITY_FIELD: Record<ListKind, string | undefined> = {
  sites: "key",
  parses: "name",
  lives: "name",
  doh: "name",
  rules: undefined,
};

function assertEntryShape(kind: ListKind, data: JsonObject): void {
  const field = IDENTITY_FIELD[kind];
  if (field && (typeof data[field] !== "string" || data[field] === ""))
    throw new AppError(`A ${kind} entry needs a non-empty "${field}"`, 422, "INVALID_ENTRY");
}

export async function listEntries(db: AppDatabase, kind?: ListKind): Promise<EntryView[]> {
  const rows = await db.select().from(tvboxEntries).where(kind ? eq(tvboxEntries.kind, kind) : undefined).orderBy(tvboxEntries.kind, tvboxEntries.sort, tvboxEntries.id).all();
  return rows.map(entryView);
}

async function getEntryRow(db: AppDatabase, id: string): Promise<EntryRow> {
  const row = await db.select().from(tvboxEntries).where(eq(tvboxEntries.id, id)).get();
  if (!row)
    throw new NotFoundError("Entry");
  return row;
}

export async function getEntry(db: AppDatabase, id: string): Promise<EntryView> {
  return entryView(await getEntryRow(db, id));
}

export async function createEntry(db: AppDatabase, kind: ListKind, data: JsonObject, enabled = true): Promise<EntryView> {
  assertEntryShape(kind, data);
  const last = await db.select({ value: max(tvboxEntries.sort) }).from(tvboxEntries).where(eq(tvboxEntries.kind, kind)).get();
  const id = ulid();
  await db.insert(tvboxEntries).values({
    id,
    kind,
    data: JSON.stringify(data),
    enabled,
    sort: (last?.value ?? -1) + 1,
  }).run();
  return await getEntry(db, id);
}

/** Editing the data marks an upstream entry as ours until reverted. */
export async function updateEntry(
  db: AppDatabase,
  id: string,
  patch: { data?: JsonObject | undefined; enabled?: boolean | undefined },
): Promise<EntryView> {
  const row = await getEntryRow(db, id);
  let dataPatch = {};
  if (patch.data !== undefined) {
    assertEntryShape(row.kind, patch.data);
    const data = JSON.stringify(patch.data);
    dataPatch = { data, locallyModified: row.upstreamData !== null && data !== row.upstreamData };
  }
  await db.update(tvboxEntries).set({
    ...dataPatch,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(tvboxEntries.id, id)).run();
  return await getEntry(db, id);
}

/** Drop the local edit and follow the upstream again. */
export async function revertEntry(db: AppDatabase, id: string): Promise<EntryView> {
  const row = await getEntryRow(db, id);
  if (row.upstreamData === null)
    throw new AppError("This entry has no upstream copy to revert to", 409, "NO_UPSTREAM_COPY");
  await db.update(tvboxEntries)
    .set({ data: row.upstreamData, locallyModified: false, updatedAt: new Date().toISOString() })
    .where(eq(tvboxEntries.id, id))
    .run();
  return await getEntry(db, id);
}

/** Only local entries can be deleted; an upstream one would come back on the next sync. */
export async function deleteEntry(db: AppDatabase, id: string): Promise<EntryView> {
  const row = await getEntryRow(db, id);
  if (row.upstreamId !== null)
    throw new AppError("Upstream entries come back on the next sync; disable it instead", 409, "UPSTREAM_ENTRY");
  await db.delete(tvboxEntries).where(eq(tvboxEntries.id, id)).run();
  return entryView(row);
}

/** `ids` in their new order; every id must belong to `kind`. */
export async function reorderEntries(db: AppDatabase, kind: ListKind, ids: readonly string[]): Promise<void> {
  const rows = await db.select({ id: tvboxEntries.id }).from(tvboxEntries).where(and(eq(tvboxEntries.kind, kind), inArray(tvboxEntries.id, [...ids]))).all();
  if (rows.length !== new Set(ids).size || rows.length !== ids.length)
    throw new AppError(`Every id must be a distinct ${kind} entry`, 422, "INVALID_ORDER");
  await db.transaction(async (tx) => {
    for (const [sort, id] of ids.entries())
      await tx.update(tvboxEntries).set({ sort }).where(eq(tvboxEntries.id, id)).run();
  });
}

// ─── Globals ───

export async function listGlobals(db: AppDatabase): Promise<GlobalView[]> {
  return (await db.select().from(tvboxGlobals).orderBy(tvboxGlobals.sort, tvboxGlobals.key).all()).map(globalView);
}

async function getGlobalRow(db: AppDatabase, key: string): Promise<GlobalRow> {
  const row = await db.select().from(tvboxGlobals).where(eq(tvboxGlobals.key, key)).get();
  if (!row)
    throw new NotFoundError("Global");
  return row;
}

export async function putGlobal(db: AppDatabase, key: string, value: unknown): Promise<GlobalView> {
  const json = JSON.stringify(value);
  const row = await db.select().from(tvboxGlobals).where(eq(tvboxGlobals.key, key)).get();
  const now = new Date().toISOString();
  if (row) {
    await db.update(tvboxGlobals)
      .set({ value: json, locallyModified: row.upstreamValue !== null && json !== row.upstreamValue, updatedAt: now })
      .where(eq(tvboxGlobals.key, key))
      .run();
  }
  else {
    const last = await db.select({ value: max(tvboxGlobals.sort) }).from(tvboxGlobals).get();
    await db.insert(tvboxGlobals).values({ key, value: json, sort: (last?.value ?? -1) + 1 }).run();
  }
  return globalView(await getGlobalRow(db, key));
}

export async function revertGlobal(db: AppDatabase, key: string): Promise<GlobalView> {
  const row = await getGlobalRow(db, key);
  if (row.upstreamValue === null)
    throw new AppError("This field has no upstream copy to revert to", 409, "NO_UPSTREAM_COPY");
  await db.update(tvboxGlobals)
    .set({ value: row.upstreamValue, locallyModified: false, updatedAt: new Date().toISOString() })
    .where(eq(tvboxGlobals.key, key))
    .run();
  return globalView(await getGlobalRow(db, key));
}

/** Only fields added here can be deleted; an upstream one would come back on the next sync. */
export async function deleteGlobal(db: AppDatabase, key: string): Promise<GlobalView> {
  const row = await getGlobalRow(db, key);
  if (row.upstreamValue !== null)
    throw new AppError("Upstream fields come back on the next sync; override the value instead", 409, "UPSTREAM_GLOBAL");
  await db.delete(tvboxGlobals).where(eq(tvboxGlobals.key, key)).run();
  return globalView(row);
}
