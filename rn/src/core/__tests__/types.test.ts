import {
  episodeNumber,
  javaSplit,
  normalizeClass,
  normalizeResult,
  normalizeSite,
  normalizeVod,
  parseEpisodes,
  parseFlags,
} from '../types';

describe('parseFlags', () => {
  it('splits play_from / play_url into flags and episodes', () => {
    const flags = parseFlags({
      vod_play_from: '线路一$$$线路二',
      vod_play_url:
        '第01集$https://cdn1.example.com/ep1.m3u8#第02集$https://cdn1.example.com/ep2.m3u8$$$第01集$https://cdn2.example.com/ep1.m3u8',
    });
    expect(flags).toEqual([
      {
        flag: '线路一',
        episodes: [
          { name: '第01集', desc: '', url: 'https://cdn1.example.com/ep1.m3u8', number: 1 },
          { name: '第02集', desc: '', url: 'https://cdn1.example.com/ep2.m3u8', number: 2 },
        ],
      },
      { flag: '线路二', episodes: [{ name: '第01集', desc: '', url: 'https://cdn2.example.com/ep1.m3u8', number: 1 }] },
    ]);
  });

  it('skips blank flags and flags without urls', () => {
    const flags = parseFlags({ vod_play_from: ' A $$$ $$$C', vod_play_url: 'u1$$$u2' });
    expect(flags.map((flag) => flag.flag)).toEqual(['A']);
  });

  it('returns nothing for an empty vod', () => {
    expect(parseFlags(normalizeVod({}))).toEqual([]);
  });
});

describe('parseEpisodes', () => {
  it('numbers unnamed episodes and keeps "$" inside urls', () => {
    expect(parseEpisodes('https://a/1.m3u8#$https://a/2.m3u8#高清 $https://a/3?x=$y#')).toEqual([
      { name: '01', desc: '', url: 'https://a/1.m3u8', number: 1 },
      { name: '02', desc: '', url: 'https://a/2.m3u8', number: 2 },
      { name: '高清', desc: '', url: 'https://a/3?x=$y', number: -1 },
    ]);
  });

  it('drops duplicate name+url pairs', () => {
    expect(parseEpisodes('a$u#a$u#a$v')).toHaveLength(2);
  });
});

describe('episodeNumber', () => {
  it('mirrors Util.getNumber', () => {
    expect(episodeNumber('第12集')).toBe(12);
    expect(episodeNumber('EP05 1080p')).toBe(5);
    expect(episodeNumber('[2023] 正片')).toBe(-1);
    expect(episodeNumber('S01E03')).toBe(3);
  });
});

describe('javaSplit', () => {
  it('drops trailing empty strings like String.split', () => {
    expect(javaSplit('a$$$b$$$', '$$$')).toEqual(['a', 'b']);
    expect(javaSplit('$$$', '$$$')).toEqual([]);
    expect(javaSplit('', '$$$')).toEqual(['']);
  });
});

describe('normalisers', () => {
  it('apply Java getter defaults', () => {
    expect(normalizeVod({ vod_id: 42, vod_name: ' 名字 ' })).toMatchObject({ vod_id: '42', vod_name: '名字', vod_pic: '', land: 0 });
    expect(normalizeSite({})).toMatchObject({ key: '', type: 0, searchable: 1, changeable: 1, quickSearch: 1, timeout: 15000, categories: [] });
    expect(normalizeClass({ id: '1', name: '电影' })).toMatchObject({ type_id: '1', type_name: '电影', filters: [] });
  });

  it('normalise a spider result', () => {
    const result = normalizeResult({
      class: [{ type_id: '1', type_name: '电影' }],
      list: [{ vod_id: 'v1', vod_name: 'A' }],
      filters: {
        '1': [{ key: 'year', name: '年份', value: [{ n: '全部', v: '' }, null, { n: '2024', v: ' 2024 ' }] }],
        '2': { key: 'area', name: '地区', value: [] },
      },
      pagecount: '5',
      url: ['线路1', 'https://a/1.m3u8', '线路2', 'https://a/2.m3u8'],
      header: { Referer: 'https://r/' },
      parse: 1,
      code: 1,
      msg: 'hidden',
    });
    expect(result.class[0]?.type_name).toBe('电影');
    expect(result.list[0]?.vod_id).toBe('v1');
    expect(result.filters['1']?.[0]?.value).toEqual([
      { n: '全部', v: '' },
      { n: '2024', v: '2024' },
    ]);
    expect(result.filters['2']?.[0]?.key).toBe('area');
    expect(result.pagecount).toBe(5);
    expect(result.url.values).toEqual([
      { n: '线路1', v: 'https://a/1.m3u8' },
      { n: '线路2', v: 'https://a/2.m3u8' },
    ]);
    expect(result.header).toEqual({ Referer: 'https://r/' });
    expect(result.parse).toBe(1);
    expect(result.msg).toBe('');
    expect(normalizeResult({ url: 'https://a/x.mp4' }).url).toEqual({ values: [{ n: '', v: 'https://a/x.mp4' }], position: 0 });
    expect(normalizeResult({})).toMatchObject({ class: [], list: [], filters: {}, page: 0, total: 0, subs: [], position: undefined });
  });
});
