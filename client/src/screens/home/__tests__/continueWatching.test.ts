import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { historyKey, MemoryStore, TIME_UNSET } from '../../../core/storage';
import { type History, normalizeHistory } from '../../../core/types';
import { getHistoryRepository, setUserDataStore } from '../../../core/userData';
import {
  type FocusSource,
  progressOf,
  remainingText,
  siteKeyOf,
  subtitleOf,
  useContinueWatching,
  vodIdOf,
} from '../continueWatching';

let mockCid: number | undefined = 1;
jest.mock('../../common/useSite', () => ({ useActiveCid: () => mockCid }));

const MINUTE = 60_000;

const history = (fields: Partial<History> = {}): History => ({
  ...normalizeHistory({ key: historyKey('cms', '42'), cid: 1 }),
  position: TIME_UNSET,
  duration: TIME_UNSET,
  ...fields,
});

describe('progressOf', () => {
  it('is position / duration clamped to 0..1', () => {
    expect(progressOf(history({ position: 30 * MINUTE, duration: 120 * MINUTE }))).toBe(0.25);
    expect(progressOf(history({ position: 130 * MINUTE, duration: 120 * MINUTE }))).toBe(1);
  });

  it('is undefined when position or duration is unknown', () => {
    expect(progressOf(history())).toBeUndefined();
    expect(progressOf(history({ position: 0, duration: 120 * MINUTE }))).toBeUndefined();
    expect(progressOf(history({ position: 10 * MINUTE }))).toBeUndefined();
  });
});

describe('remainingText', () => {
  it('rounds the remaining time up to the minute', () => {
    expect(remainingText(history({ position: 22 * MINUTE + 1000, duration: 45 * MINUTE }))).toBe('剩余 23 分钟');
    expect(remainingText(history({ position: 45 * MINUTE - 1, duration: 45 * MINUTE }))).toBe('剩余 1 分钟');
  });

  it('adds hours past sixty minutes', () => {
    expect(remainingText(history({ position: 10 * MINUTE, duration: 135 * MINUTE }))).toBe('剩余 2 小时 5 分钟');
    expect(remainingText(history({ position: 10 * MINUTE, duration: 70 * MINUTE }))).toBe('剩余 1 小时 0 分钟');
  });

  it('is undefined without position and duration', () => {
    expect(remainingText(history())).toBeUndefined();
  });
});

describe('subtitleOf', () => {
  it('joins the episode and the remaining time, omitting missing parts', () => {
    const timed = { position: 22 * MINUTE, duration: 45 * MINUTE };
    expect(subtitleOf(history({ vodRemarks: '第 4 集', ...timed }))).toBe('第 4 集 · 剩余 23 分钟');
    expect(subtitleOf(history({ vodRemarks: '第 4 集' }))).toBe('第 4 集');
    expect(subtitleOf(history(timed))).toBe('剩余 23 分钟');
    expect(subtitleOf(history())).toBe('');
  });
});

describe('siteKeyOf / vodIdOf', () => {
  it('split the history key', () => {
    const item = history({ key: historyKey('site_a', 'https://x/1') });
    expect(siteKeyOf(item)).toBe('site_a');
    expect(vodIdOf(item)).toBe('https://x/1');
  });
});

describe('useContinueWatching', () => {
  beforeEach(() => {
    setUserDataStore(new MemoryStore());
    mockCid = 1;
  });
  afterAll(() => setUserDataStore(undefined));

  async function seed(cid: number, ids: string[]) {
    for (const id of ids) {
      // Distinct createTime stamps keep the newest-first order deterministic.
      await getHistoryRepository().upsert({ cid, key: historyKey('cms', id), vodName: id });
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
  }

  async function render(navigation?: FocusSource) {
    const result: { items?: History[]; refresh?: () => void } = {};
    function Probe() {
      Object.assign(result, useContinueWatching(navigation));
      return null;
    }
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(createElement(Probe));
    });
    return { result, rerender: () => act(async () => renderer.update(createElement(Probe))) };
  }

  const names = (items?: History[]) => items?.map((item) => item.vodName);

  it('lists the active config newest first, at most 20', async () => {
    const ids = Array.from({ length: 22 }, (_, i) => `v${i}`);
    await seed(1, ids);
    await seed(2, ['other']);
    const { result } = await render();
    expect(result.items).toHaveLength(20);
    expect(names(result.items)?.slice(0, 2)).toEqual(['v21', 'v20']);
    expect(names(result.items)).not.toContain('other');
  });

  it('is empty without an active config', async () => {
    mockCid = undefined;
    await seed(1, ['a']);
    const { result } = await render();
    expect(result.items).toEqual([]);
  });

  it('re-reads on focus and on refresh', async () => {
    const listeners: (() => void)[] = [];
    const navigation: FocusSource = {
      addListener: (_event, listener) => {
        listeners.push(listener);
        return () => listeners.splice(listeners.indexOf(listener), 1);
      },
    };
    const { result } = await render(navigation);
    expect(result.items).toEqual([]);
    expect(listeners).toHaveLength(1);

    await seed(1, ['a']);
    await act(async () => listeners[0]!());
    expect(names(result.items)).toEqual(['a']);

    await seed(1, ['b']);
    await act(async () => result.refresh!());
    expect(names(result.items)).toEqual(['b', 'a']);
  });

  it('switches lists when the active config changes', async () => {
    await seed(1, ['a']);
    await seed(2, ['b']);
    const { result, rerender } = await render();
    expect(names(result.items)).toEqual(['a']);
    mockCid = 2;
    await rerender();
    expect(names(result.items)).toEqual(['b']);
  });
});
