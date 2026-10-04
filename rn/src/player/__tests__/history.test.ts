import { MemoryStore, historyKey, TIME_UNSET } from '../../core/storage';
import { createEpisode, parseEpisodes } from '../../core/types';
import { getHistoryRepository, setUserDataStore } from '../../core/userData';
import { createHistoryTracker, pickEpisode, SAVE_INTERVAL, shouldSkipEnding, startPosition } from '../history';

const KEY = historyKey('cms', '1');
const flags = [
  { flag: 'a', episodes: parseEpisodes('E1$u1#E2$u2') },
  { flag: 'b', episodes: parseEpisodes('E1$v1#E2$v2') },
];

function tracker(options: { incognito?: boolean; now?: () => number } = {}) {
  return createHistoryTracker({ repo: getHistoryRepository(), cid: 1, key: KEY, enabled: () => !options.incognito, now: options.now });
}

beforeEach(() => setUserDataStore(new MemoryStore()));

describe('episode selection and resume', () => {
  it('prefers the route hint, then the history record', () => {
    expect(pickEpisode(flags, { flag: 'b', episodeUrl: 'v2' })).toEqual({ flagIndex: 1, episodeIndex: 1 });
    expect(pickEpisode(flags, { flag: 'b' })).toEqual({ flagIndex: 1, episodeIndex: 0 });
    const history = { vodFlag: 'b', vodRemarks: 'e2', episodeUrl: '' } as never;
    expect(pickEpisode(flags, {}, history)).toEqual({ flagIndex: 1, episodeIndex: 1 });
    expect(pickEpisode(flags, {})).toEqual({ flagIndex: 0, episodeIndex: 0 });
  });

  it('resumes only the recorded episode and applies the opening skip', () => {
    const history = { vodRemarks: 'E2', episodeUrl: 'u2', position: 60_000, opening: 5_000 } as never;
    expect(startPosition(history, createEpisode('E2', 'u2'))).toBe(60_000);
    expect(startPosition(history, createEpisode('E1', 'u1'))).toBe(5_000);
    expect(startPosition(history, createEpisode('E1', 'u1'), 90_000)).toBe(90_000);
    expect(startPosition(undefined, createEpisode('E1', 'u1'))).toBeUndefined();
  });

  it('detects the ending skip', () => {
    expect(shouldSkipEnding({ ending: 10_000 }, 50_000, 60_000)).toBe(true);
    expect(shouldSkipEnding({ ending: 10_000 }, 49_000, 60_000)).toBe(false);
    expect(shouldSkipEnding({ ending: TIME_UNSET }, 59_000, 60_000)).toBe(false);
  });
});

describe('history tracker', () => {
  it('updates the record Detail wrote and saves progress periodically', async () => {
    const repo = getHistoryRepository();
    await repo.upsert({ key: KEY, cid: 1, vodName: 'Show', vodFlag: 'a', vodRemarks: 'E2', episodeUrl: 'u2', position: 30_000, duration: 100_000, revSort: true });
    let time = 1_000_000;
    const t = tracker({ now: () => time });
    const history = await t.open({ vodName: 'Show' });
    expect(history).toMatchObject({ position: 30_000, revSort: true });

    await t.setEpisode('a', createEpisode('E2', 'u2'));
    expect(t.current()?.position).toBe(30_000);

    time += SAVE_INTERVAL;
    await t.progress(40_000, 100_000);
    expect(await repo.get(1, KEY)).toMatchObject({ position: 40_000 });
    time += SAVE_INTERVAL - 1;
    await t.progress(45_000, 100_000);
    expect(await repo.get(1, KEY)).toMatchObject({ position: 40_000 });
    time += 1;
    await t.progress(46_000, 100_000);
    expect(await repo.get(1, KEY)).toMatchObject({ position: 46_000, revSort: true });

    await t.setSpeed(1.5);
    await t.progress(47_000, 100_000);
    await t.setEpisode('b', createEpisode('E1', 'v1'));
    expect(await repo.get(1, KEY)).toMatchObject({
      vodFlag: 'b',
      vodRemarks: 'E1',
      episodeUrl: 'v1',
      position: TIME_UNSET,
      duration: TIME_UNSET,
      speed: 1.5,
    });
  });

  it('creates the record when missing and flushes on demand', async () => {
    const t = tracker({ now: () => 0 });
    await t.open({ vodName: 'Show', vodPic: 'p' });
    expect(await getHistoryRepository().get(1, KEY)).toMatchObject({ vodName: 'Show', vodPic: 'p' });
    await t.setEpisode('a', createEpisode('E1', 'u1'));
    await t.progress(1_000, 2_000);
    await t.progress(1_500, 2_000);
    await t.flush();
    expect(await getHistoryRepository().get(1, KEY)).toMatchObject({ position: 1_500, duration: 2_000, vodRemarks: 'E1' });
  });

  it('writes nothing while incognito', async () => {
    const t = tracker({ incognito: true });
    expect(await t.open({ vodName: 'Show' })).toBeUndefined();
    expect(await getHistoryRepository().get(1, KEY)).toBeUndefined();

    await getHistoryRepository().upsert({ key: KEY, cid: 1, position: 10, duration: 20 });
    const existing = tracker({ incognito: true });
    await existing.open({ vodName: 'Show' });
    await existing.setEpisode('a', createEpisode('E1', 'u1'));
    await existing.progress(15_000, 20_000);
    await existing.flush();
    expect(await getHistoryRepository().get(1, KEY)).toMatchObject({ position: 10, vodFlag: '' });
  });
});
