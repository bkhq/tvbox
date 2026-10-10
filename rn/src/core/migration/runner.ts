import { legacyReader, type LegacyDb, type LegacyPrefs, type LegacyReader } from '../../../modules/migrate';
import { DEVICE_ID_KEY } from '../serverLink/deviceId';
import { SERVER_LINK_KEY } from '../serverLink/serverLink';
import { SETTINGS_STORAGE_KEY } from '../settings/settings';
import {
  asyncStorageStore,
  type ConfigKind,
  createConfigRepository,
  createHistoryRepository,
  createKeepRepository,
  type KeyValueStore,
  readJson,
  storageKey,
  writeJson,
} from '../storage';
import { isObject } from '../types';
import { type LegacyConfig, mapConfigs, mapDeviceId, mapHistory, mapKeep, mapServerLink, mapSettings } from './mapping';

/** Set after one successful pass; its presence skips the migration. */
export const MIGRATION_KEY = storageKey('migration', 1);

export interface MigrationOptions {
  store?: KeyValueStore;
  /** Defaults to the native module; null (iOS, tvOS, tests) makes the run a no-op. */
  reader?: LegacyReader | null;
  log?: (message: string, error: unknown) => void;
}

/**
 * One-time import of the Java app's data on first launch after the in-place
 * upgrade. Existing RN values always win; the Java data is only read. Resolves
 * true when a pass completed in this call, false otherwise; never rejects.
 */
export async function runMigration(options: MigrationOptions = {}): Promise<boolean> {
  const { store = asyncStorageStore, reader = legacyReader, log = console.warn } = options;
  if (!reader) return false;
  try {
    if ((await store.getItem(MIGRATION_KEY)) !== null) return false;
    const [prefs, db] = await Promise.all([reader.readLegacyPrefs(), reader.readLegacyDb()]);
    await migrate(store, prefs, db);
    await writeJson(store, MIGRATION_KEY, { time: Date.now() });
    return true;
  } catch (error) {
    log('Migration from the Java app failed', error);
    return false;
  }
}

async function migrate(store: KeyValueStore, prefs: LegacyPrefs, db: LegacyDb): Promise<void> {
  const link = mapServerLink(prefs);
  if (link && (await store.getItem(SERVER_LINK_KEY)) === null) await writeJson(store, SERVER_LINK_KEY, link);

  const deviceId = mapDeviceId(prefs);
  if (deviceId && (await store.getItem(DEVICE_ID_KEY)) === null) await store.setItem(DEVICE_ID_KEY, deviceId);

  const configs = mapConfigs(db.config);
  const vod = await migrateConfigs(store, 'vod', configs.vod, configs.activeVod);
  await migrateConfigs(store, 'live', configs.live, configs.activeLive);

  // Config.home only applies while the Java active config is still the active one.
  await migrateSettings(store, prefs, vod.activeIsLegacy ? configs.activeVod?.home : undefined);

  await migrateHistory(store, db, vod.ids);
  await migrateKeep(store, db, vod.ids);
}

/** Adds missing configs (oldest first, keeping Java times) and maps Java config ids to RN ids. */
async function migrateConfigs(
  store: KeyValueStore,
  kind: ConfigKind,
  items: readonly LegacyConfig[],
  active: LegacyConfig | undefined,
): Promise<{ ids: Map<number, number>; activeIsLegacy: boolean }> {
  let stamp = 0;
  const repo = createConfigRepository(store, kind, () => stamp);
  const ids = new Map<number, number>();
  for (const item of items) {
    const saved = await repo.find(item.url);
    if (saved) {
      ids.set(item.id, saved.id);
      continue;
    }
    stamp = item.time;
    ids.set(item.id, (await repo.add({ url: item.url, name: item.name })).id);
  }
  if (active && !(await repo.getActive())) await repo.setActive(active.url);
  return { ids, activeIsLegacy: active !== undefined && (await repo.getActive())?.url === active.url };
}

async function migrateSettings(store: KeyValueStore, prefs: LegacyPrefs, home: string | undefined): Promise<void> {
  const raw = await readJson(store, SETTINGS_STORAGE_KEY);
  const existing = isObject(raw) ? raw : {};
  const added = Object.entries(mapSettings(prefs, home)).filter(([key]) => !(key in existing));
  if (added.length > 0) await writeJson(store, SETTINGS_STORAGE_KEY, { ...existing, ...Object.fromEntries(added) });
}

/** Re-adds in time order with the Java createTime; records whose config was not migrated are skipped. */
async function migrateHistory(store: KeyValueStore, db: LegacyDb, ids: Map<number, number>): Promise<void> {
  let stamp = 0;
  const repo = createHistoryRepository(store, () => stamp);
  const records = mapHistory(db.history).sort((a, b) => a.createTime - b.createTime);
  for (const { createTime, ...record } of records) {
    const cid = ids.get(record.cid);
    if (cid === undefined || (await repo.get(cid, record.key))) continue;
    stamp = createTime;
    await repo.upsert({ ...record, cid });
  }
}

async function migrateKeep(store: KeyValueStore, db: LegacyDb, ids: Map<number, number>): Promise<void> {
  let stamp = 0;
  const repo = createKeepRepository(store, () => stamp);
  const records = mapKeep(db.keep).sort((a, b) => a.createTime - b.createTime);
  for (const { createTime, ...record } of records) {
    const type = record.type === 1 ? 1 : 0;
    const cid = type === 1 ? 0 : ids.get(record.cid);
    if (cid === undefined || (await repo.isKept(record.key, cid, type))) continue;
    stamp = createTime;
    await repo.add({ ...record, cid, type });
  }
}
