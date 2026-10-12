import { readFileSync } from 'fs';
import { join } from 'path';

import { getAbiFlavor, legacyReader, type LegacyDb, type LegacyPrefs, type LegacyReader } from '../../../../modules/migrate';
import { DEVICE_ID_KEY } from '../../serverLink/deviceId';
import { SERVER_LINK_KEY } from '../../serverLink/serverLink';
import { SETTINGS_STORAGE_KEY } from '../../settings/settings';
import { createConfigRepository, createHistoryRepository, createKeepRepository, MemoryStore, TIME_UNSET } from '../../storage';
import { mapConfigs, mapDeviceId, mapHistory, mapKeep, mapServerLink, mapSettings } from '../mapping';
import { MIGRATION_KEY, runMigration } from '../runner';

const FIXTURES = join(__dirname, '..', '__fixtures__');
const prefs = JSON.parse(readFileSync(join(FIXTURES, 'prefs.json'), 'utf8')) as LegacyPrefs;
const db = JSON.parse(readFileSync(join(FIXTURES, 'db.json'), 'utf8')) as LegacyDb;
/** Read time for history lists, so the fixture records are within HISTORY_TIME. */
const NOW = 1700000100000;

/** SharedPreferences XML -> the typed map MigrateModule.readLegacyPrefs returns. */
function parsePrefsXml(xml: string): LegacyPrefs {
  const result: LegacyPrefs = {};
  const unescape = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  for (const [, type, name, value] of xml.matchAll(/<(boolean|int|long|float) name="([^"]+)" value="([^"]*)" \/>/g)) {
    if (type === 'boolean') result[name!] = { type, value: value === 'true' };
    else result[name!] = { type: type as 'int' | 'long' | 'float', value: Number(value) };
  }
  for (const [, name, value] of xml.matchAll(/<string name="([^"]+)">([^<]*)<\/string>/g)) {
    result[name!] = { type: 'string', value: unescape(value!) };
  }
  for (const [, name, body] of xml.matchAll(/<set name="([^"]+)">([\s\S]*?)<\/set>/g)) {
    result[name!] = { type: 'set', value: [...body!.matchAll(/<string>([^<]*)<\/string>/g)].map((m) => unescape(m[1]!)) };
  }
  return result;
}

function reader(overrides: Partial<LegacyReader> = {}): LegacyReader {
  return {
    readLegacyPrefs: async () => prefs,
    readLegacyDb: async () => db,
    ...overrides,
  };
}

const silent = () => {};

describe('fixtures', () => {
  it('prefs.json is the typed form of the SharedPreferences XML', () => {
    const xml = readFileSync(join(FIXTURES, 'com.fongmi.android.tv_preferences.xml'), 'utf8');
    expect(parsePrefsXml(xml)).toEqual(prefs);
  });
});

describe('mapping', () => {
  it('maps the server link and device id', () => {
    expect(mapServerLink(prefs)).toEqual({
      enabled: true,
      code: 'ABCD-EFGH',
      subscription: 'https://worker.example.com/sub/abc',
      deviceKey: 'dk-123',
    });
    expect(mapDeviceId(prefs)).toBe('02:AB:CD:EF:01:23');
    expect(mapServerLink({})).toBeUndefined();
    expect(mapDeviceId({ airplay_device_id: { type: 'int', value: 1 } })).toBeUndefined();
  });

  it('maps settings through the schema, skipping invalid values', () => {
    expect(mapSettings(prefs, 'siteB')).toEqual({
      doh: 'https://dns.example.com/dns-query',
      ua: 'Mozilla/5.0 Test',
      airplay: false,
      airplayName: '客厅电视',
      incognito: true,
      siteMode: 1,
      playerEngine: 'mpv',
      render: 'texture',
      background: false,
      buffer: 10,
      audioPassThrough: false,
      tunnel: true,
      speedPlayback: 1.5,
      speedLongPress: 3,
      subtitleStyleSource: 'custom',
      subtitleEdgeType: 'dropShadow',
      subtitleForegroundColor: 0xffffff00,
      subtitleScale: 1.25,
      homeSiteKey: 'siteB',
    });
  });

  it('ignores prefs stored with an unexpected type', () => {
    expect(mapSettings({ doh: { type: 'int', value: 1 }, incognito: { type: 'string', value: 'true' } })).toEqual({});
  });

  it('maps VOD and live configs with the most recent one active', () => {
    const configs = mapConfigs(db.config);
    expect(configs.vod.map((c) => c.url)).toEqual(['https://vod.example.com/a.json', 'https://vod.example.com/b.json']);
    expect(configs.live.map((c) => c.url)).toEqual(['https://live.example.com/b.txt', 'https://live.example.com/a.m3u']);
    expect(configs.activeVod).toMatchObject({ id: 2, home: 'siteB' });
    expect(configs.activeLive).toMatchObject({ id: 3, name: 'Live A' });
  });

  it('maps history and keep rows, skipping malformed keys', () => {
    const history = mapHistory(db.history);
    expect(history.map((h) => h.key)).toEqual(['siteB@@@vod1', 'siteA@@@vod2', 'siteC@@@vod3']);
    expect(history[0]).toMatchObject({ cid: 2, revSort: true, revPlay: false, opening: 90000, ending: TIME_UNSET, speed: 1.25, scale: 2 });
    expect(mapKeep(db.keep)).toEqual([
      expect.objectContaining({ key: 'siteB@@@vod1', cid: 2, type: 0, siteName: '站点B' }),
      expect.objectContaining({ key: 'CCTV-1', cid: 0, type: 1, siteName: '' }),
      expect.objectContaining({ key: 'siteC@@@vod3', cid: 99, type: 0 }),
    ]);
  });
});

describe('runMigration', () => {
  it('imports everything into an empty store', async () => {
    const store = new MemoryStore();
    await expect(runMigration({ store, reader: reader(), log: silent })).resolves.toBe(true);

    expect(JSON.parse(store.data.get(SERVER_LINK_KEY)!)).toEqual(mapServerLink(prefs));
    expect(store.data.get(DEVICE_ID_KEY)).toBe('02:AB:CD:EF:01:23');
    expect(store.data.has(MIGRATION_KEY)).toBe(true);

    const vod = createConfigRepository(store, 'vod');
    expect((await vod.list()).map((c) => [c.url, c.name, c.time])).toEqual([
      ['https://vod.example.com/b.json', 'B', 3000],
      ['https://vod.example.com/a.json', 'A', 1000],
    ]);
    const activeVod = await vod.getActive();
    expect(activeVod?.url).toBe('https://vod.example.com/b.json');
    const live = createConfigRepository(store, 'live');
    expect((await live.getActive())?.url).toBe('https://live.example.com/a.m3u');
    expect(await live.list()).toHaveLength(2);

    const settings = JSON.parse(store.data.get(SETTINGS_STORAGE_KEY)!);
    expect(settings).toMatchObject({ doh: 'https://dns.example.com/dns-query', playerEngine: 'mpv', homeSiteKey: 'siteB' });

    const cidA = (await vod.find('https://vod.example.com/a.json'))!.id;
    const history = createHistoryRepository(store, () => NOW);
    expect(await history.list(activeVod!.id)).toEqual([
      expect.objectContaining({ key: 'siteB@@@vod1', vodName: '剧集一', createTime: 1700000000000, position: 600000 }),
    ]);
    expect((await history.list(cidA)).map((h) => h.key)).toEqual(['siteA@@@vod2']);

    const keep = createKeepRepository(store);
    expect((await keep.list(activeVod!.id)).map((k) => [k.key, k.createTime])).toEqual([['siteB@@@vod1', 1700000001000]]);
    expect((await keep.list(0, 1)).map((k) => k.key)).toEqual(['CCTV-1']);
  });

  it('is a no-op on the second run', async () => {
    const store = new MemoryStore();
    await runMigration({ store, reader: reader(), log: silent });
    const before = new Map(store.data);
    const readPrefs = jest.fn(async () => prefs);
    await expect(runMigration({ store, reader: reader({ readLegacyPrefs: readPrefs }), log: silent })).resolves.toBe(false);
    expect(readPrefs).not.toHaveBeenCalled();
    expect(store.data).toEqual(before);
  });

  it('never overwrites existing RN data', async () => {
    const store = new MemoryStore();
    const link = { enabled: false, code: 'MINE-CODE', subscription: '', deviceKey: '' };
    store.data.set(SERVER_LINK_KEY, JSON.stringify(link));
    store.data.set(DEVICE_ID_KEY, '02:00:00:00:00:01');
    store.data.set(SETTINGS_STORAGE_KEY, JSON.stringify({ doh: 'mine', homeSiteKey: 'mySite' }));
    const vod = createConfigRepository(store, 'vod', () => 5000);
    const mine = await vod.add({ url: 'https://mine.example.com/c.json', name: 'Mine' });
    await vod.setActive(mine.url);
    const existingB = await vod.add({ url: 'https://vod.example.com/b.json', name: 'B (rn)' });
    const history = createHistoryRepository(store, () => NOW);
    await history.upsert({ key: 'siteB@@@vod1', cid: existingB.id, vodName: 'rn record', position: 1 });

    await expect(runMigration({ store, reader: reader(), log: silent })).resolves.toBe(true);

    expect(JSON.parse(store.data.get(SERVER_LINK_KEY)!)).toEqual(link);
    expect(store.data.get(DEVICE_ID_KEY)).toBe('02:00:00:00:00:01');
    const settings = JSON.parse(store.data.get(SETTINGS_STORAGE_KEY)!);
    expect(settings).toMatchObject({ doh: 'mine', homeSiteKey: 'mySite', ua: 'Mozilla/5.0 Test' });
    expect((await vod.getActive())?.url).toBe(mine.url);
    expect(await vod.find('https://vod.example.com/b.json')).toEqual(existingB);
    expect(await vod.find('https://vod.example.com/a.json')).toBeDefined();
    expect(await history.get(existingB.id, 'siteB@@@vod1')).toMatchObject({ vodName: 'rn record', position: 1 });
  });

  it('logs failures and leaves the marker unset so the next launch retries', async () => {
    const store = new MemoryStore();
    const log = jest.fn();
    const failing = reader({ readLegacyDb: () => Promise.reject(new Error('disk')) });
    await expect(runMigration({ store, reader: failing, log })).resolves.toBe(false);
    expect(log).toHaveBeenCalledWith(expect.any(String), expect.any(Error));
    expect(store.data.has(MIGRATION_KEY)).toBe(false);

    await expect(runMigration({ store, reader: reader(), log: silent })).resolves.toBe(true);
    expect(store.data.has(MIGRATION_KEY)).toBe(true);
  });

  it('handles an empty Java install', async () => {
    const store = new MemoryStore();
    const empty = reader({ readLegacyPrefs: async () => ({}), readLegacyDb: async () => ({ config: [], history: [], keep: [] }) });
    await expect(runMigration({ store, reader: empty, log: silent })).resolves.toBe(true);
    expect([...store.data.keys()]).toEqual([MIGRATION_KEY]);
  });

  it('is a no-op without the native module (iOS / tvOS)', async () => {
    expect(legacyReader).toBeNull();
    expect(getAbiFlavor()).toBe('');
    const store = new MemoryStore();
    await expect(runMigration({ store })).resolves.toBe(false);
    expect(store.data.size).toBe(0);
  });
});
