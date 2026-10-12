import type { LiveConfig } from '../../../core/config/liveConfig';
import { createConfigRepository, MemoryStore } from '../../../core/storage';
import { normalizeLive } from '../../../core/types';
import { setUserDataStore } from '../../../core/userData';
import { loadLiveGroups, loadLiveSources, readLiveState, saveLiveHome, saveLiveKeep } from '../source';

const a = normalizeLive({ name: 'A', url: 'http://a/list.txt' });
const b = normalizeLive({ name: 'B', url: 'http://b/list.txt' });

afterEach(() => setUserDataStore(undefined));

describe('live sources', () => {
  it('uses the VOD config lives with the saved home', async () => {
    const store = new MemoryStore();
    expect((await loadLiveSources({ store, vodLives: [a, b] })).home?.name).toBe('A');
    await saveLiveHome('B', store);
    const sources = await loadLiveSources({ store, vodLives: [a, b] });
    expect(sources.lives).toEqual([a, b]);
    expect(sources.home?.name).toBe('B');
  });

  it('prefers the active saved live config', async () => {
    const store = new MemoryStore();
    const configs = createConfigRepository(store, 'live');
    await configs.add({ url: 'http://cfg/live.json' });
    await configs.setActive('http://cfg/live.json');
    await saveLiveHome('B', store);
    const loadConfig = jest.fn(async () => ({ lives: [a, b], home: b }) as unknown as LiveConfig);

    const sources = await loadLiveSources({ store, vodLives: [], loadConfig });
    expect(loadConfig).toHaveBeenCalledWith('http://cfg/live.json', { home: 'B' });
    expect(sources.home).toBe(b);
  });

  it('keeps the last channel per source', async () => {
    const store = new MemoryStore();
    await saveLiveKeep('A', '央视@@@CCTV1@@@http://x', store);
    await saveLiveKeep('B', '卫视@@@浙江@@@http://y', store);
    await saveLiveHome('A', store);
    expect(await readLiveState(store)).toEqual({
      home: 'A',
      keep: { A: '央视@@@CCTV1@@@http://x', B: '卫视@@@浙江@@@http://y' },
    });
  });

  it('loads groups with favourites and splits password groups', async () => {
    setUserDataStore(new MemoryStore());
    const live = normalizeLive({
      name: 'inline',
      groups: [
        { name: '央视', channel: [{ name: 'CCTV1', urls: ['http://x/1'] }] },
        { name: 'VIP', pass: '123', channel: [{ name: 'V', urls: ['http://x/v'] }] },
      ],
    });
    const { visible, hidden } = await loadLiveGroups(live);
    expect(visible.map((group) => group.name)).toEqual(['收藏', '央视']);
    expect(hidden.map((group) => group.name)).toEqual(['VIP']);
  });
});
