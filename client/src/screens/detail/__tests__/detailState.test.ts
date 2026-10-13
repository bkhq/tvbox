import { TIME_UNSET } from '../../../core/storage';
import { type History, parseFlags } from '../../../core/types';
import {
  buildHistoryInput,
  buildPlayerParams,
  episodeProgress,
  resolveResume,
  sortEpisodes,
  splitPeople,
  tagLine,
} from '../detailState';

const flags = parseFlags({ vod_play_from: 'a$$$b', vod_play_url: '第1集$a1#第2集$a2$$$第1集$b1#第2集$b2#第3集$b3' });

function history(overrides: Partial<History>): History {
  return {
    key: 'cms@@@v1',
    cid: 1,
    vodPic: '',
    vodName: '',
    vodFlag: 'b',
    vodRemarks: '',
    episodeUrl: 'b2',
    revSort: false,
    revPlay: false,
    createTime: 0,
    opening: TIME_UNSET,
    ending: TIME_UNSET,
    position: 5000,
    duration: TIME_UNSET,
    speed: 1,
    scale: -1,
    ...overrides,
  };
}

describe('resolveResume', () => {
  it('defaults to the first flag without history', () => {
    expect(resolveResume(flags, undefined)).toEqual({ flagIndex: 0, revSort: false });
  });

  it('selects the saved flag and episode with its sort order', () => {
    expect(resolveResume(flags, history({ revSort: true }))).toEqual({
      flagIndex: 1,
      revSort: true,
      episode: flags[1]!.episodes[1],
    });
  });

  it('falls back to the first flag when the saved flag is gone', () => {
    expect(resolveResume(flags, history({ vodFlag: 'gone', revSort: true }))).toEqual({ flagIndex: 0, revSort: true });
  });

  it('keeps the flag but no episode when the saved episode is gone', () => {
    expect(resolveResume(flags, history({ episodeUrl: 'gone' }))).toEqual({
      flagIndex: 1,
      revSort: false,
      episode: undefined,
    });
  });
});

describe('sortEpisodes', () => {
  it('reverses without mutating', () => {
    const episodes = flags[1]!.episodes;
    expect(sortEpisodes(episodes, true).map((item) => item.url)).toEqual(['b3', 'b2', 'b1']);
    expect(episodes.map((item) => item.url)).toEqual(['b1', 'b2', 'b3']);
  });
});

describe('buildHistoryInput', () => {
  const base = { key: 'cms@@@v1', cid: 1, vod: { vod_name: '影片', vod_pic: 'p.jpg' }, revSort: true };

  it('keeps the saved position for the same episode', () => {
    expect(buildHistoryInput({ ...base, flag: 'b', episode: flags[1]!.episodes[1]!, existing: history({}) })).toEqual({
      key: 'cms@@@v1',
      cid: 1,
      vodName: '影片',
      vodPic: 'p.jpg',
      vodFlag: 'b',
      vodRemarks: '第2集',
      episodeUrl: 'b2',
      revSort: true,
      position: 5000,
    });
  });

  it('resets the position for another episode or without history', () => {
    const other = buildHistoryInput({ ...base, flag: 'b', episode: flags[1]!.episodes[0]!, existing: history({}) });
    expect(other).toMatchObject({ episodeUrl: 'b1', vodRemarks: '第1集', position: TIME_UNSET });
    const fresh = buildHistoryInput({ ...base, flag: 'a', episode: flags[0]!.episodes[0]! });
    expect(fresh).toMatchObject({ vodFlag: 'a', episodeUrl: 'a1', position: TIME_UNSET });
  });
});

describe('buildPlayerParams', () => {
  const episode = flags[0]!.episodes[0]!;

  it('passes a known position', () => {
    expect(buildPlayerParams('cms', 'v1', 'a', episode, 5000)).toEqual({
      siteKey: 'cms',
      vodId: 'v1',
      flag: 'a',
      episodeUrl: 'a1',
      position: 5000,
    });
  });

  it('omits an unset position', () => {
    expect(buildPlayerParams('cms', 'v1', 'a', episode, TIME_UNSET)).toEqual({
      siteKey: 'cms',
      vodId: 'v1',
      flag: 'a',
      episodeUrl: 'a1',
    });
    expect(buildPlayerParams('cms', 'v1', 'a', episode)).not.toHaveProperty('position');
  });
});

describe('tagLine', () => {
  it('joins only the present parts', () => {
    expect(tagLine({ type_name: '剧情', vod_area: '大陆', vod_year: '2024' })).toBe('剧情 · 大陆 · 2024');
    expect(tagLine({ type_name: '', vod_area: '大陆', vod_year: '' })).toBe('大陆');
    expect(tagLine({ type_name: '', vod_area: '', vod_year: '' })).toBe('');
  });
});

describe('splitPeople', () => {
  it('splits on the common separators', () => {
    expect(splitPeople('甲,乙，丙/丁、戊 己  庚')).toEqual(['甲', '乙', '丙', '丁', '戊', '己', '庚']);
    expect(splitPeople('')).toEqual([]);
    expect(splitPeople(undefined)).toEqual([]);
  });
});

describe('episodeProgress', () => {
  const episode = flags[1]!.episodes[1]!;

  it('is the watched fraction of the history episode', () => {
    expect(episodeProgress(history({ position: 30, duration: 120 }), 'b', episode)).toBe(0.25);
  });

  it('is undefined for another episode or without a position and duration', () => {
    expect(episodeProgress(undefined, 'b', episode)).toBeUndefined();
    expect(episodeProgress(history({ duration: 120 }), 'a', episode)).toBeUndefined();
    expect(episodeProgress(history({ duration: 120 }), 'b', flags[1]!.episodes[0]!)).toBeUndefined();
    expect(episodeProgress(history({ position: 30, duration: TIME_UNSET }), 'b', episode)).toBeUndefined();
    expect(episodeProgress(history({ position: TIME_UNSET, duration: 120 }), 'b', episode)).toBeUndefined();
  });
});
