import type { JsonObject, ListKind } from "./parse";
import type { AppDatabase } from "@/db";
import { and, count, eq, inArray, isNull, max, ne } from "drizzle-orm";
import { chunked } from "@/shared/lib/chunk";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { writeDevicesFile } from "./devices.service";
import { tvboxDeviceUpstreams, tvboxEntries, tvboxGlobals, tvboxUpstreams } from "./schema";

export type UpstreamRow = typeof tvboxUpstreams.$inferSelect;
export interface UpstreamView extends UpstreamRow {
  readonly entryCount: number;
  /** Devices that picked it explicitly; devices on every upstream are not counted. */
  readonly deviceCount: number;
}
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

export async function listUpstreams(db: AppDatabase): Promise<UpstreamView[]> {
  const rows = await db.select().from(tvboxUpstreams).orderBy(tvboxUpstreams.id).all();
  const entries = await db.select({ id: tvboxEntries.upstreamId, n: count() }).from(tvboxEntries).groupBy(tvboxEntries.upstreamId).all();
  const devices = await db.select({ id: tvboxDeviceUpstreams.upstreamId, n: count() }).from(tvboxDeviceUpstreams).groupBy(tvboxDeviceUpstreams.upstreamId).all();
  return rows.map(r => ({
    ...r,
    entryCount: entries.find(e => e.id === r.id)?.n ?? 0,
    deviceCount: devices.find(d => d.id === r.id)?.n ?? 0,
  }));
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

/** Its entries and device links go with it; globals it supplied stay, they are ours now. */
export async function deleteUpstream(db: AppDatabase, id: string): Promise<UpstreamRow> {
  const row = await getUpstream(db, id);
  await db.delete(tvboxUpstreams).where(eq(tvboxUpstreams.id, id)).run();
  await writeDevicesFile(db);
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

/** `source`: an upstream id, or "common" for the entries added here. `deleted`: the deleted ones instead. */
export async function listEntries(db: AppDatabase, kind?: ListKind, source?: string, deleted = false): Promise<EntryView[]> {
  const bySource = source === undefined
    ? undefined
    : source === "common" ? isNull(tvboxEntries.upstreamId) : eq(tvboxEntries.upstreamId, source);
  const rows = await db.select().from(tvboxEntries).where(and(kind ? eq(tvboxEntries.kind, kind) : undefined, bySource, eq(tvboxEntries.deleted, deleted))).orderBy(tvboxEntries.kind, tvboxEntries.sort, tvboxEntries.id).all();
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

/**
 * Editing the data marks an upstream entry as ours until reverted. Switching
 * on an entry the health check switched off is an admin vouching for it: it
 * becomes exempt from the check. Switching one off is the admin's call, not
 * the check's.
 */
export async function updateEntry(
  db: AppDatabase,
  id: string,
  patch: { data?: JsonObject | undefined; enabled?: boolean | undefined; healthExempt?: boolean | undefined },
): Promise<EntryView> {
  const row = await getEntryRow(db, id);
  if (row.deleted)
    throw new AppError("This entry is deleted; restore it first", 409, "ENTRY_DELETED");
  let dataPatch = {};
  if (patch.data !== undefined) {
    assertEntryShape(row.kind, patch.data);
    const data = JSON.stringify(patch.data);
    dataPatch = { data, locallyModified: row.upstreamData !== null && data !== row.upstreamData };
  }
  let healthPatch: Partial<EntryRow> = patch.healthExempt !== undefined ? { healthExempt: patch.healthExempt } : {};
  if (patch.enabled === true && row.disabledByHealth)
    healthPatch = { healthExempt: true, disabledByHealth: false };
  else if (patch.enabled === false)
    healthPatch = { ...healthPatch, disabledByHealth: false };
  await db.update(tvboxEntries).set({
    ...dataPatch,
    ...healthPatch,
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(tvboxEntries.id, id)).run();
  return await getEntry(db, id);
}

/** Enable or disable many entries at once, with the same health rules as {@link updateEntry}. */
export async function setEntriesEnabled(db: AppDatabase, ids: readonly string[], enabled: boolean): Promise<number> {
  const unique = [...new Set(ids)];
  if (unique.length === 0)
    return 0;
  const updatedAt = new Date().toISOString();
  await db.transaction(async (tx) => {
    for (const ids of chunked(unique)) {
      if (enabled) {
        await tx.update(tvboxEntries)
          .set({ healthExempt: true, disabledByHealth: false })
          .where(and(inArray(tvboxEntries.id, ids), eq(tvboxEntries.disabledByHealth, true), eq(tvboxEntries.deleted, false)))
          .run();
      }
      await tx.update(tvboxEntries)
        .set({ enabled, updatedAt, ...(enabled ? {} : { disabledByHealth: false }) })
        .where(and(inArray(tvboxEntries.id, ids), eq(tvboxEntries.deleted, false)))
        .run();
    }
  });
  return unique.length;
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

// An upstream entry is only marked: removing the row would let the next sync
// import it again.
const TOMBSTONE = { deleted: true, enabled: false, disabledByHealth: false, healthExempt: false } as const;

/** A local entry is removed; an upstream one is hidden for good, until restored. */
export async function deleteEntry(db: AppDatabase, id: string): Promise<EntryView> {
  const row = await getEntryRow(db, id);
  if (row.upstreamId === null)
    await db.delete(tvboxEntries).where(eq(tvboxEntries.id, id)).run();
  else
    await db.update(tvboxEntries).set({ ...TOMBSTONE, updatedAt: new Date().toISOString() }).where(eq(tvboxEntries.id, id)).run();
  return entryView(row);
}

/** {@link deleteEntry} for many; returns how many were deleted. */
export async function deleteEntries(db: AppDatabase, ids: readonly string[]): Promise<number> {
  const unique = [...new Set(ids)];
  const updatedAt = new Date().toISOString();
  let n = 0;
  await db.transaction(async (tx) => {
    for (const part of chunked(unique)) {
      const rows = await tx.select({ id: tvboxEntries.id, upstreamId: tvboxEntries.upstreamId }).from(tvboxEntries).where(and(inArray(tvboxEntries.id, part), eq(tvboxEntries.deleted, false))).all();
      const local = rows.filter(r => r.upstreamId === null).map(r => r.id);
      const upstream = rows.filter(r => r.upstreamId !== null).map(r => r.id);
      if (local.length > 0)
        await tx.delete(tvboxEntries).where(inArray(tvboxEntries.id, local)).run();
      if (upstream.length > 0)
        await tx.update(tvboxEntries).set({ ...TOMBSTONE, updatedAt }).where(inArray(tvboxEntries.id, upstream)).run();
      n += rows.length;
    }
  });
  return n;
}

/** Bring a deleted upstream entry back, enabled. */
export async function restoreEntry(db: AppDatabase, id: string): Promise<EntryView> {
  const row = await getEntryRow(db, id);
  if (!row.deleted)
    throw new AppError("This entry is not deleted", 409, "ENTRY_NOT_DELETED");
  await db.update(tvboxEntries).set({ deleted: false, enabled: true, updatedAt: new Date().toISOString() }).where(eq(tvboxEntries.id, id)).run();
  return await getEntry(db, id);
}

/** `ids` in their new order; every id must belong to `kind`. */
export async function reorderEntries(db: AppDatabase, kind: ListKind, ids: readonly string[]): Promise<void> {
  const known = new Set((await db.select({ id: tvboxEntries.id }).from(tvboxEntries).where(eq(tvboxEntries.kind, kind)).all()).map(r => r.id));
  const rows = ids.filter(id => known.has(id));
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

/** `keep`: stop following the upstream even when the value equals its current one. */
export async function putGlobal(db: AppDatabase, key: string, value: unknown, options: { keep?: boolean | undefined } = {}): Promise<GlobalView> {
  const json = JSON.stringify(value);
  const row = await db.select().from(tvboxGlobals).where(eq(tvboxGlobals.key, key)).get();
  const now = new Date().toISOString();
  if (row) {
    await db.update(tvboxGlobals)
      .set({ value: json, locallyModified: row.upstreamValue !== null && (options.keep === true || json !== row.upstreamValue), updatedAt: now })
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
