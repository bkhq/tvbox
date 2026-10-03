import type { JsonObject, ListKind, MirroredAsset } from "./parse";
import type { AppDatabase } from "@/db";
import type { Logger } from "@/shared/lib/logger";
import { and, eq, max } from "drizzle-orm";
import { deriveStorageKey } from "@/modules/file/storage/key";
import { getActiveDriver } from "@/modules/file/storage/registry";
import { AppError, NotFoundError } from "@/shared/lib/errors";
import { ulid } from "@/shared/lib/id";
import { assetName, collectAssetUrls, decodeUpstream, entryIdentity, LIST_KINDS, resolveRelative, rewriteAssets } from "./parse";
import { tvboxAssets, tvboxEntries, tvboxGlobals, tvboxUpstreams } from "./schema";
import { hashHex } from "./storage";

const CONFIG_TIMEOUT_MS = 30_000;
const ASSET_TIMEOUT_MS = 60_000;
const MAX_ASSET_BYTES = 50 * 1024 * 1024;
const ASSET_CONCURRENCY = 4;

export interface SyncDeps {
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
}

export interface SyncResult {
  readonly added: number;
  readonly updated: number;
  readonly removed: number;
  readonly assets: { readonly mirrored: number; readonly failed: readonly string[] };
}

export function changeCount(result: SyncResult): number {
  return result.added + result.updated + result.removed;
}

async function fetchBytes(fetchImpl: typeof fetch, url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  if (!res.ok)
    throw new Error(`${url} returned ${res.status}`);
  const length = Number(res.headers.get("content-length") ?? 0);
  if (length > MAX_ASSET_BYTES)
    throw new Error(`${url} is larger than ${MAX_ASSET_BYTES} bytes`);
  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_ASSET_BYTES)
    throw new Error(`${url} is larger than ${MAX_ASSET_BYTES} bytes`);
  return buffer;
}

/**
 * Copy each URL into blob storage. A file that cannot be fetched keeps its
 * previous mirror when there is one, so a flaky upstream never takes a
 * working file away; with no previous mirror the URL is left pointing
 * upstream.
 */
async function mirrorAssets(
  db: AppDatabase,
  urls: readonly string[],
  fetchImpl: typeof fetch,
  logger: Logger,
): Promise<{ mirrored: Map<string, MirroredAsset>; failed: string[] }> {
  const mirrored = new Map<string, MirroredAsset>();
  const failed: string[] = [];
  const driver = getActiveDriver();

  const queue = [...urls];
  async function worker(): Promise<void> {
    for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
      const previous = await db.select().from(tvboxAssets).where(eq(tvboxAssets.sourceUrl, url)).get();
      try {
        const buffer = await fetchBytes(fetchImpl, url, ASSET_TIMEOUT_MS);
        const sha256 = hashHex("sha256", buffer);
        const asset = { sha256, md5: hashHex("md5", buffer), name: assetName(url) };
        if (previous?.sha256 !== sha256)
          await driver.put(deriveStorageKey(sha256), buffer);
        const row = { ...asset, size: buffer.byteLength, fetchedAt: new Date().toISOString() };
        if (previous)
          await db.update(tvboxAssets).set(row).where(eq(tvboxAssets.id, previous.id)).run();
        else
          await db.insert(tvboxAssets).values({ id: ulid(), sourceUrl: url, ...row }).run();
        mirrored.set(url, asset);
      }
      catch (err) {
        logger.warn({ err, url }, "tvbox: asset mirror failed");
        failed.push(url);
        if (previous)
          mirrored.set(url, { sha256: previous.sha256, md5: previous.md5, name: previous.name });
      }
    }
  }
  await Promise.all(Array.from({ length: ASSET_CONCURRENCY }, worker));
  return { mirrored, failed };
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((v): v is JsonObject => v !== null && typeof v === "object" && !Array.isArray(v))
    : [];
}

export async function syncUpstream(db: AppDatabase, upstreamId: string, deps: SyncDeps): Promise<SyncResult> {
  const fetchImpl = deps.fetch ?? fetch;
  const upstream = await db.select().from(tvboxUpstreams).where(eq(tvboxUpstreams.id, upstreamId)).get();
  if (!upstream)
    throw new NotFoundError("Upstream");

  try {
    const raw = decodeUpstream(new TextDecoder().decode(await fetchBytes(fetchImpl, upstream.url, CONFIG_TIMEOUT_MS)));
    const resolved = resolveRelative(raw, upstream.url) as JsonObject;
    const assets = await mirrorAssets(db, [...collectAssetUrls(resolved, upstream.url)], fetchImpl, deps.logger);
    const config = rewriteAssets(resolved, assets.mirrored) as JsonObject;

    // A secondary upstream's sites need its spider: only the primary's
    // spider is published at the top level.
    if (!upstream.isPrimary && typeof config.spider === "string") {
      config.sites = asObjects(config.sites).map(site => ("jar" in site ? site : { ...site, jar: config.spider }));
    }

    const counts = await db.transaction(async (tx) => {
      const totals = { added: 0, updated: 0, removed: 0 };
      for (const kind of LIST_KINDS) {
        const c = await mergeEntries(tx as unknown as AppDatabase, upstream.id, kind, asObjects(config[kind]));
        totals.added += c.added;
        totals.updated += c.updated;
        totals.removed += c.removed;
      }
      if (upstream.isPrimary) {
        const c = await mergeGlobals(tx as unknown as AppDatabase, config);
        totals.added += c.added;
        totals.updated += c.updated;
        totals.removed += c.removed;
      }
      await tx.update(tvboxUpstreams)
        .set({ lastSyncedAt: new Date().toISOString(), lastStatus: "ok", lastError: null })
        .where(eq(tvboxUpstreams.id, upstream.id))
        .run();
      return totals;
    });
    return { ...counts, assets: { mirrored: assets.mirrored.size, failed: assets.failed } };
  }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(tvboxUpstreams)
      .set({ lastSyncedAt: new Date().toISOString(), lastStatus: "error", lastError: message })
      .where(eq(tvboxUpstreams.id, upstream.id))
      .run();
    throw new AppError(`Sync failed: ${message}`, 502, "UPSTREAM_SYNC_FAILED");
  }
}

async function mergeEntries(db: AppDatabase, upstreamId: string, kind: ListKind, incoming: readonly JsonObject[]) {
  const totals = { added: 0, updated: 0, removed: 0 };
  const existing = await db.select().from(tvboxEntries).where(and(eq(tvboxEntries.upstreamId, upstreamId), eq(tvboxEntries.kind, kind))).all();
  const byKey = new Map(existing.map(row => [row.upstreamKey, row]));
  const last = await db.select({ value: max(tvboxEntries.sort) }).from(tvboxEntries).where(eq(tvboxEntries.kind, kind)).get();
  let nextSort = (last?.value ?? -1) + 1;
  const now = new Date().toISOString();
  const seen = new Set<string>();

  for (const item of incoming) {
    const key = entryIdentity(kind, item);
    if (seen.has(key))
      continue;
    seen.add(key);
    const data = JSON.stringify(item);
    const row = byKey.get(key);

    if (!row) {
      await db.insert(tvboxEntries).values({
        id: ulid(),
        kind,
        upstreamId,
        upstreamKey: key,
        data,
        upstreamData: data,
        sort: nextSort++,
      }).run();
      totals.added++;
      continue;
    }

    const changed = row.upstreamData !== data;
    if (!changed && !row.upstreamRemoved)
      continue;
    // A row the upstream had dropped is back: sync disabled it, so sync
    // re-enables it. Rows disabled by hand were never marked removed.
    const reappeared = row.upstreamRemoved;
    const follow = !row.locallyModified;
    await db.update(tvboxEntries).set({
      upstreamData: data,
      ...(follow ? { data } : {}),
      ...(reappeared ? { upstreamRemoved: false, enabled: true } : {}),
      updatedAt: now,
    }).where(eq(tvboxEntries.id, row.id)).run();
    if ((changed && follow) || reappeared)
      totals.updated++;
  }

  for (const row of existing) {
    if (row.upstreamKey !== null && !seen.has(row.upstreamKey) && !row.upstreamRemoved) {
      await db.update(tvboxEntries)
        .set({ upstreamRemoved: true, enabled: false, updatedAt: now })
        .where(eq(tvboxEntries.id, row.id))
        .run();
      totals.removed++;
    }
  }
  return totals;
}

async function mergeGlobals(db: AppDatabase, config: JsonObject) {
  const totals = { added: 0, updated: 0, removed: 0 };
  const lists = new Set<string>(LIST_KINDS);
  const incoming = Object.entries(config).filter(([key]) => !lists.has(key));
  const existing = await db.select().from(tvboxGlobals).all();
  const byKey = new Map(existing.map(row => [row.key, row]));
  const now = new Date().toISOString();

  for (const [sort, [key, raw]] of incoming.entries()) {
    const value = JSON.stringify(raw);
    const row = byKey.get(key);
    if (!row) {
      await db.insert(tvboxGlobals).values({ key, value, upstreamValue: value, sort }).run();
      totals.added++;
    }
    else if (row.upstreamValue !== value) {
      await db.update(tvboxGlobals)
        .set({ upstreamValue: value, ...(row.locallyModified ? {} : { value }), updatedAt: now })
        .where(eq(tvboxGlobals.key, key))
        .run();
      if (!row.locallyModified)
        totals.updated++;
    }
  }

  const present = new Set(incoming.map(([key]) => key));
  for (const row of existing) {
    if (present.has(row.key) || row.upstreamValue === null)
      continue;
    if (row.locallyModified) {
      await db.update(tvboxGlobals).set({ upstreamValue: null, updatedAt: now }).where(eq(tvboxGlobals.key, row.key)).run();
    }
    else {
      await db.delete(tvboxGlobals).where(eq(tvboxGlobals.key, row.key)).run();
      totals.removed++;
    }
  }
  return totals;
}

/** Upstreams the scheduled sync visits, primary first. */
export async function listSyncableUpstreams(db: AppDatabase) {
  const rows = await db.select().from(tvboxUpstreams).where(eq(tvboxUpstreams.syncEnabled, true)).all();
  return rows.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
}
