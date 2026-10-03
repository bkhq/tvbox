import type { DevicesFile } from "./storage";
import type { AppDatabase } from "@/db";
import { randomBytes } from "node:crypto";
import { desc, eq, isNotNull } from "drizzle-orm";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { tvboxDevices, tvboxDeviceUpstreams, tvboxEnrollments, tvboxUpstreams } from "./schema";
import { DEVICES_KEY, hashHex, putObject } from "./storage";

type DeviceRow = typeof tvboxDevices.$inferSelect;

export interface DeviceView extends Omit<DeviceRow, "tokenHash"> {
  /** Upstreams the device follows; ignored while `allUpstreams` is true. */
  readonly upstreamIds: readonly string[];
}

export interface DeviceInput {
  readonly name: string;
  readonly note?: string | undefined;
  /** null: every upstream, now and later. */
  readonly upstreamIds: readonly string[] | null;
}

function newToken(): { token: string; tokenHash: string; hint: string } {
  const token = randomBytes(16).toString("hex");
  return { token, tokenHash: hashHex("sha256", token), hint: token.slice(-4) };
}

/**
 * The Worker resolves a subscription token against this file instead of the
 * database, so a TVBox client never wakes the Durable Object. Rewritten after
 * every change to devices or upstreams.
 */
export async function writeDevicesFile(db: AppDatabase): Promise<void> {
  const devices = await db.select().from(tvboxDevices).where(eq(tvboxDevices.enabled, true)).all();
  const links = await db.select().from(tvboxDeviceUpstreams).all();
  const expand = await collectionExpander(db);
  const keyed = (await db.select().from(tvboxEnrollments).where(eq(tvboxEnrollments.status, "approved")).all())
    .filter(e => e.deviceKey !== null && e.appDeviceId !== "");
  const file: DevicesFile = {
    devices: Object.fromEntries(devices.map((d) => {
      const bindings = keyed.filter(e => e.deviceRef === d.id).map(e => ({ id: e.appDeviceId, keyHash: hashHex("sha256", e.deviceKey!) }));
      return [d.tokenHash, {
        id: d.id,
        upstreams: d.allUpstreams ? null : expand(links.filter(l => l.deviceId === d.id).map(l => l.upstreamId)),
        ...(bindings.length > 0 ? { bindings } : {}),
      }];
    })),
  };
  await putObject(DEVICES_KEY, JSON.stringify(file));
}

export async function listDevices(db: AppDatabase): Promise<DeviceView[]> {
  const devices = await db.select().from(tvboxDevices).orderBy(desc(tvboxDevices.id)).all();
  const links = await db.select().from(tvboxDeviceUpstreams).all();
  return devices.map(({ tokenHash: _, ...d }) => ({ ...d, upstreamIds: links.filter(l => l.deviceId === d.id).map(l => l.upstreamId) }));
}

export async function getDevice(db: AppDatabase, id: string): Promise<DeviceView> {
  const device = (await listDevices(db)).find(d => d.id === id);
  if (!device)
    throw new NotFoundError("Device");
  return device;
}

async function setUpstreams(db: AppDatabase, deviceId: string, upstreamIds: readonly string[]): Promise<void> {
  const unique = [...new Set(upstreamIds)];
  if (unique.length > 0) {
    const known = new Set((await db.select({ id: tvboxUpstreams.id }).from(tvboxUpstreams).all()).map(r => r.id));
    if (!unique.every(id => known.has(id)))
      throw new AppError("Unknown upstream", 422, "UNKNOWN_UPSTREAM");
  }
  await db.transaction(async (tx) => {
    await tx.delete(tvboxDeviceUpstreams).where(eq(tvboxDeviceUpstreams.deviceId, deviceId)).run();
    for (const upstreamId of unique)
      await tx.insert(tvboxDeviceUpstreams).values({ deviceId, upstreamId }).run();
  });
}

export async function createDevice(db: AppDatabase, input: DeviceInput, userId: string): Promise<DeviceView> {
  const id = ulid();
  await db.insert(tvboxDevices).values({
    id,
    name: input.name,
    note: input.note ?? "",
    allUpstreams: input.upstreamIds === null,
    createdBy: userId,
    ...newToken(),
  }).run();
  if (input.upstreamIds !== null) {
    try {
      await setUpstreams(db, id, input.upstreamIds);
    }
    catch (err) {
      await db.delete(tvboxDevices).where(eq(tvboxDevices.id, id)).run();
      throw err;
    }
  }
  await writeDevicesFile(db);
  return await getDevice(db, id);
}

export async function updateDevice(
  db: AppDatabase,
  id: string,
  patch: {
    readonly name?: string | undefined;
    readonly note?: string | undefined;
    readonly enabled?: boolean | undefined;
    readonly upstreamIds?: readonly string[] | null | undefined;
  },
): Promise<DeviceView> {
  await getDevice(db, id);
  if (patch.upstreamIds !== undefined && patch.upstreamIds !== null)
    await setUpstreams(db, id, patch.upstreamIds);
  await db.update(tvboxDevices).set({
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.note !== undefined ? { note: patch.note } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    ...(patch.upstreamIds !== undefined ? { allUpstreams: patch.upstreamIds === null } : {}),
    updatedAt: new Date().toISOString(),
  }).where(eq(tvboxDevices.id, id)).run();
  await writeDevicesFile(db);
  return await getDevice(db, id);
}

/** A new subscription URL; the old one stops working within a minute. */
export async function rotateDevice(db: AppDatabase, id: string): Promise<DeviceView> {
  await getDevice(db, id);
  await db.update(tvboxDevices).set({ ...newToken(), updatedAt: new Date().toISOString() }).where(eq(tvboxDevices.id, id)).run();
  await writeDevicesFile(db);
  return await getDevice(db, id);
}

export async function deleteDevice(db: AppDatabase, id: string): Promise<DeviceView> {
  const device = await getDevice(db, id);
  await db.delete(tvboxDevices).where(eq(tvboxDevices.id, id)).run();
  await writeDevicesFile(db);
  return device;
}

/** Picking a collection picks every line it lists, now and later. */
async function collectionExpander(db: AppDatabase): Promise<(ids: readonly string[]) => string[]> {
  const lines = await db.select({ id: tvboxUpstreams.id, parentId: tvboxUpstreams.parentId }).from(tvboxUpstreams).where(isNotNull(tvboxUpstreams.parentId)).all();
  return (ids) => {
    const picked = new Set(ids);
    return [...ids, ...lines.filter(l => picked.has(l.parentId!) && !picked.has(l.id)).map(l => l.id)];
  };
}

/** Upstreams a device would follow: null for every upstream. */
export async function deviceUpstreams(db: AppDatabase, device: DeviceView): Promise<readonly string[] | null> {
  return device.allUpstreams ? null : (await collectionExpander(db))(device.upstreamIds);
}
