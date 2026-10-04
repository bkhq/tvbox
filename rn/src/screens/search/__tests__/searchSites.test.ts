import { normalizeResult, normalizeSite, type Result, type Site } from '../../../core/types';
import { searchSites, searchTargets, type SearchProgress } from '../searchSites';

function site(key: string, extra: Record<string, unknown> = {}): Site {
  return { ...normalizeSite({ key, name: `站点 ${key}`, type: 1, api: `https://${key}.example.com`, ...extra }), supported: true };
}

function result(...ids: string[]): Result {
  return normalizeResult({ list: ids.map((id) => ({ vod_id: id, vod_name: id })) });
}

interface Deferred {
  resolve: (value: Result) => void;
  reject: (error: Error) => void;
}

/** search() whose answers are released by the test. */
function controlled() {
  const pending = new Map<string, Deferred>();
  let inFlight = 0;
  let maxInFlight = 0;
  const search = jest.fn(
    (target: Site) =>
      new Promise<Result>((resolve, reject) => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        const settle = () => inFlight--;
        pending.set(target.key, {
          resolve: (value) => {
            settle();
            resolve(value);
          },
          reject: (error) => {
            settle();
            reject(error);
          },
        });
      }),
  );
  return { search, pending, maxInFlight: () => maxInFlight };
}

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

function track() {
  const updates: SearchProgress[] = [];
  return { updates, onUpdate: (progress: SearchProgress) => updates.push(progress), last: () => updates[updates.length - 1]! };
}

describe('searchTargets', () => {
  const sites = [
    site('a'),
    site('off', { searchable: 0 }),
    site('user-off', { searchable: 2 }),
    site('slow', { quickSearch: 0 }),
    { ...site('jar'), supported: false },
  ];

  it('keeps supported searchable sites', () => {
    expect(searchTargets(sites, false).map((s) => s.key)).toEqual(['a', 'slow']);
  });

  it('also requires quickSearch in quick mode', () => {
    expect(searchTargets(sites, true).map((s) => s.key)).toEqual(['a']);
  });
});

describe('searchSites', () => {
  it('respects the concurrency cap', async () => {
    const targets = ['a', 'b', 'c', 'd', 'e'].map((key) => site(key));
    const { search, pending, maxInFlight } = controlled();
    const { onUpdate, last } = track();
    const handle = searchSites(targets, search, onUpdate, { concurrency: 2 });
    await flush();
    expect(search).toHaveBeenCalledTimes(2);

    pending.get('a')!.resolve(result('a1'));
    await flush();
    expect(search).toHaveBeenCalledTimes(3);
    for (const key of ['b', 'c', 'd', 'e']) {
      pending.get(key)!.resolve(result(`${key}1`));
      await flush();
    }
    await handle.done;
    expect(maxInFlight()).toBe(2);
    expect(last()).toMatchObject({ completed: 5, total: 5, done: true });
  });

  it('isolates failing and slow sites', async () => {
    jest.useFakeTimers();
    try {
      const targets = [site('ok'), site('fail'), site('throw'), site('slow')];
      const search = jest.fn((target: Site): Promise<Result> => {
        if (target.key === 'ok') return Promise.resolve(result('ok1'));
        if (target.key === 'fail') return Promise.reject(new Error('boom'));
        if (target.key === 'throw') throw new Error('sync boom');
        return new Promise<Result>(() => undefined);
      });
      const { onUpdate, last } = track();
      const handle = searchSites(targets, search, onUpdate, { timeoutMs: 1000 });
      await jest.advanceTimersByTimeAsync(0);
      expect(last()).toMatchObject({ completed: 3, done: false });

      await jest.advanceTimersByTimeAsync(1000);
      await handle.done;
      expect(last()).toMatchObject({ completed: 4, total: 4, done: true });
      expect(last().groups.map((group) => group.site.key)).toEqual(['ok']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('streams groups in site order and drops empty sites', async () => {
    const targets = [site('a'), site('empty'), site('b')];
    const { search, pending } = controlled();
    const { onUpdate, updates, last } = track();
    const handle = searchSites(targets, search, onUpdate);
    expect(updates[0]).toEqual({ groups: [], completed: 0, total: 3, done: false });
    await flush();

    pending.get('b')!.resolve(result('b1', 'b2'));
    await flush();
    expect(last().groups.map((group) => group.site.key)).toEqual(['b']);

    pending.get('empty')!.resolve(result());
    pending.get('a')!.resolve(result('a1'));
    await handle.done;
    expect(last().groups.map((group) => [group.site.key, group.list.map((vod) => vod.vod_id)])).toEqual([
      ['a', ['a1']],
      ['b', ['b1', 'b2']],
    ]);
    expect(last().done).toBe(true);
  });

  it('reports done immediately without targets', () => {
    const { onUpdate, last } = track();
    searchSites([], jest.fn(), onUpdate);
    expect(last()).toEqual({ groups: [], completed: 0, total: 0, done: true });
  });

  it('drops answers and stops launching sites after cancel', async () => {
    const targets = [site('a'), site('b'), site('c')];
    const { search, pending } = controlled();
    const { onUpdate, updates } = track();
    const handle = searchSites(targets, search, onUpdate, { concurrency: 1 });
    await flush();
    handle.cancel();

    pending.get('a')!.resolve(result('a1'));
    await handle.done;
    expect(search).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
  });
});
