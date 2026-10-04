import AsyncStorage from '@react-native-async-storage/async-storage';

import { createConfigRepository } from '../configs';
import { createHistoryRepository, HISTORY_MAX, HISTORY_TIME, historyKey, splitHistoryKey } from '../history';
import { jsonCell, readJson, storageKey } from '../json';
import { createKeepRepository } from '../keep';
import { asyncStorageStore, MemoryStore } from '../keyValueStore';

function clock(start = 1_000_000_000_000) {
  let time = start;
  const now = () => time;
  return { now, tick: (ms = 1000) => (time += ms) };
}

describe('KeyValueStore', () => {
  beforeEach(() => AsyncStorage.clear());

  it.each([
    ['memory', new MemoryStore()],
    ['AsyncStorage', asyncStorageStore],
  ])('%s store supports get/set/remove/multiGet', async (_, store) => {
    await store.setItem('a', '1');
    await store.setItem('b', '2');
    expect(await store.getItem('a')).toBe('1');
    expect(await store.multiGet(['a', 'b', 'c'])).toEqual([
      ['a', '1'],
      ['b', '2'],
      ['c', null],
    ]);
    await store.removeItem('a');
    expect(await store.getItem('a')).toBeNull();
  });
});

describe('json helpers', () => {
  it('builds versioned keys', () => {
    expect(storageKey('history', 1)).toBe('tvbox.history.v1');
  });

  it('treats corrupt json as missing', async () => {
    const store = new MemoryStore();
    await store.setItem('k', '{oops');
    expect(await readJson(store, 'k')).toBeUndefined();
  });

  it('serialises concurrent updates', async () => {
    const store = new MemoryStore();
    const cell = jsonCell(store, 'n', (raw) => (typeof raw === 'number' ? raw : 0));
    await Promise.all(Array.from({ length: 10 }, () => cell.update((n) => ({ value: n + 1, result: undefined }))));
    expect(await cell.read()).toBe(10);
  });
});

describe('config repository', () => {
  it('round-trips add / setActive / remove and keeps vod and live apart', async () => {
    const store = new MemoryStore();
    const { now, tick } = clock();
    const vod = createConfigRepository(store, 'vod', now);
    const live = createConfigRepository(store, 'live', now);

    const a = await vod.add({ url: 'https://a.example/config.json', name: 'A' });
    tick();
    const b = await vod.add({ url: 'https://b.example/config.json' });
    await live.add({ url: 'https://live.example/tv.m3u', name: '直播' });

    expect(a.id).not.toBe(b.id);
    expect((await vod.list()).map((item) => item.url)).toEqual([b.url, a.url]);
    expect((await live.list()).map((item) => item.name)).toEqual(['直播']);

    await vod.setActive(a.url);
    expect((await vod.getActive())?.url).toBe(a.url);
    expect(await live.getActive()).toBeUndefined();

    tick();
    const again = await vod.add({ url: a.url });
    expect(again).toMatchObject({ id: a.id, name: 'A', time: now() });
    expect((await vod.list())[0]?.url).toBe(a.url);

    // A fresh repository over the same store sees the same state.
    const reloaded = createConfigRepository(store, 'vod', now);
    expect((await reloaded.getActive())?.id).toBe(a.id);

    await vod.remove(a.url);
    expect(await vod.getActive()).toBeUndefined();
    expect((await vod.list()).map((item) => item.url)).toEqual([b.url]);
    const c = await vod.add({ url: 'https://c.example' });
    expect(c.id).toBeGreaterThan(b.id);
  });

  it('refuses to activate an unsaved url', async () => {
    const vod = createConfigRepository(new MemoryStore(), 'vod');
    await expect(vod.setActive('https://missing.example')).rejects.toThrow('Config not saved');
  });
});

describe('history repository', () => {
  const key = historyKey('csp_demo', 'vod1');

  it('splits keys', () => {
    expect(splitHistoryKey(key)).toEqual({ siteKey: 'csp_demo', vodId: 'vod1' });
  });

  it('upserts one record per (cid, key) and merges fields', async () => {
    const { now, tick } = clock();
    const history = createHistoryRepository(new MemoryStore(), now);

    const first = await history.upsert({ key, cid: 1, vodName: '剧集', vodPic: 'pic', vodFlag: '线路一' });
    expect(first).toMatchObject({ speed: 1, scale: -1, position: -1, duration: -1, createTime: now() });

    tick();
    await history.upsert({ key, cid: 1, vodRemarks: '第02集', episodeUrl: 'u2', position: 5000, duration: 60000, opening: 1000 });
    await history.upsert({ key, cid: 2, vodName: 'other config' });

    const stored = await history.get(1, key);
    expect(stored).toMatchObject({
      vodName: '剧集',
      vodPic: 'pic',
      vodFlag: '线路一',
      vodRemarks: '第02集',
      episodeUrl: 'u2',
      position: 5000,
      duration: 60000,
      opening: 1000,
      ending: -1,
      createTime: now(),
    });
    expect(await history.list(1)).toHaveLength(1);
    expect(await history.list(2)).toHaveLength(1);
  });

  it('lists newest first', async () => {
    const { now, tick } = clock();
    const history = createHistoryRepository(new MemoryStore(), now);
    for (const id of ['a', 'b', 'c']) {
      await history.upsert({ key: historyKey('s', id), cid: 1 });
      tick();
    }
    await history.upsert({ key: historyKey('s', 'a'), cid: 1 });
    expect((await history.list(1)).map((item) => splitHistoryKey(item.key).vodId)).toEqual(['a', 'c', 'b']);
  });

  it('trims to HISTORY_MAX per config and drops expired records', async () => {
    const { now, tick } = clock();
    const store = new MemoryStore();
    const history = createHistoryRepository(store, now);
    await history.upsert({ key: historyKey('s', 'old'), cid: 1 });
    await history.upsert({ key: historyKey('s', 'other'), cid: 2 });
    tick(HISTORY_TIME + 1);
    for (let i = 0; i < HISTORY_MAX + 5; i++) {
      await history.upsert({ key: historyKey('s', `v${i}`), cid: 1 });
      tick();
    }
    const list = await history.list(1);
    expect(list).toHaveLength(HISTORY_MAX);
    expect(list[0]?.key).toBe(historyKey('s', `v${HISTORY_MAX + 4}`));
    expect(list.at(-1)?.key).toBe(historyKey('s', 'v5'));
    expect(await history.get(1, historyKey('s', 'old'))).toBeUndefined();
    expect(await history.get(2, historyKey('s', 'other'))).toBeUndefined();
  });

  it('deletes one record and clears one config', async () => {
    const { now } = clock();
    const history = createHistoryRepository(new MemoryStore(), now);
    await history.upsert({ key: historyKey('s', 'a'), cid: 1 });
    await history.upsert({ key: historyKey('s', 'b'), cid: 1 });
    await history.upsert({ key: historyKey('s', 'a'), cid: 2 });

    await history.delete(1, historyKey('s', 'a'));
    expect((await history.list(1)).map((item) => item.key)).toEqual([historyKey('s', 'b')]);
    expect(await history.get(2, historyKey('s', 'a'))).toBeDefined();

    await history.clear(1);
    expect(await history.list(1)).toEqual([]);
    expect(await history.list(2)).toHaveLength(1);
  });
});

describe('keep repository', () => {
  const item = { key: historyKey('s', 'v1'), cid: 1, siteName: '站点', vodName: '影片', vodPic: 'pic' };

  it('adds, checks and removes per config', async () => {
    const { now, tick } = clock();
    const keep = createKeepRepository(new MemoryStore(), now);
    await keep.add(item);
    tick();
    await keep.add({ ...item, key: historyKey('s', 'v2') });
    await keep.add({ ...item, cid: 2 });

    expect(await keep.isKept(item.key, 1)).toBe(true);
    expect((await keep.list(1)).map((k) => k.key)).toEqual([historyKey('s', 'v2'), item.key]);
    expect(await keep.list(2)).toHaveLength(1);

    await keep.add(item);
    expect(await keep.list(1)).toHaveLength(2);

    await keep.remove(item.key, 1);
    expect(await keep.isKept(item.key, 1)).toBe(false);
    expect(await keep.isKept(item.key, 2)).toBe(true);
  });

  it('matches live keeps by key regardless of config', async () => {
    const keep = createKeepRepository(new MemoryStore());
    await keep.add({ ...item, key: 'CCTV-1', type: 1 });
    expect(await keep.isKept('CCTV-1', 9, 1)).toBe(true);
    expect(await keep.isKept('CCTV-1', 1)).toBe(false);
    expect(await keep.list(9, 1)).toHaveLength(1);
    await keep.remove('CCTV-1', 9, 1);
    expect(await keep.list(1, 1)).toEqual([]);
  });
});
