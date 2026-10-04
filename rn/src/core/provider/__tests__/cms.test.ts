import { parseSite } from '../../config/vodConfig';
import type { FetchLike } from '../../http';
import type { JsonObject } from '../../types';
import { buildUrl, CmsProvider, isVideoFormat, parseXmlResult } from '../cms';
import category from '../__fixtures__/category.json';
import detail from '../__fixtures__/detail.json';
import home from '../__fixtures__/home.json';
import { XML_DETAIL, XML_HOME, XML_SEARCH } from '../__fixtures__/xml';

type MockFetch = jest.Mock<Promise<Response>, [string, RequestInit?]> & FetchLike;

/** Answers each call with the next body in order. */
function mockFetch(...bodies: string[]): MockFetch {
  let index = 0;
  return jest.fn(async (url: string) => {
    const body = bodies[Math.min(index++, bodies.length - 1)] ?? '';
    return { ok: true, status: 200, url, text: async () => body } as Response;
  }) as MockFetch;
}

function site(json: JsonObject) {
  return parseSite({ key: 'cms', name: 'CMS', api: 'https://cms.example.com/api.php/provide/vod/', ...json });
}

function query(fetch: MockFetch, call = 0): Record<string, string> {
  const url = fetch.mock.calls[call]?.[0] ?? '';
  const search = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
  const result: Record<string, string> = {};
  for (const pair of search.split('&').filter(Boolean)) {
    const [key = '', value = ''] = pair.split('=');
    result[decodeURIComponent(key)] = decodeURIComponent(value);
  }
  return result;
}

describe('buildUrl', () => {
  it('appends params to an api with or without a query', () => {
    expect(buildUrl('https://a/api', { ac: 'detail', wd: '三 体' })).toBe('https://a/api?ac=detail&wd=%E4%B8%89%20%E4%BD%93');
    expect(buildUrl('https://a/api?x=1', { t: '2' })).toBe('https://a/api?x=1&t=2');
    expect(buildUrl('https://a/api?', { t: '2' })).toBe('https://a/api?t=2');
    expect(buildUrl('https://a/api', {})).toBe('https://a/api');
  });
});

describe('type 0 (XML)', () => {
  const xmlSite = site({ type: 0, header: { 'User-Agent': 'tvbox' }, timeout: 5 });

  it('home parses classes and refetches the list when pictures are missing', async () => {
    const fetch = mockFetch(XML_HOME, XML_DETAIL);
    const result = await new CmsProvider(xmlSite, { fetch }).home(true);

    expect(fetch.mock.calls[0]?.[0]).toBe(xmlSite.api);
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ 'User-Agent': 'tvbox' });
    expect(query(fetch, 1)).toEqual({ ac: 'videolist', ids: '101,202' });
    expect(result.class.map((c) => [c.type_id, c.type_name])).toEqual([
      ['1', '电影'],
      ['2', '电视剧'],
      ['3', '综艺'],
    ]);
    expect(result.list.map((v) => v.vod_pic)).toEqual(['https://img.example.com/202.jpg']);
  });

  it('home applies site.categories order and filters the fetchPic ids', async () => {
    const fetch = mockFetch(XML_HOME, XML_DETAIL);
    const result = await new CmsProvider(site({ type: 0, categories: ['电视剧', '电影', '不存在'] }), { fetch }).home(true);

    expect(result.class.map((c) => c.type_name)).toEqual(['电视剧', '电影']);
    expect(query(fetch, 1).ids).toBe('101,202');
  });

  it('fetchPic clears the list when no item is in site.categories', async () => {
    const fetch = mockFetch(XML_HOME);
    const result = await new CmsProvider(site({ type: 0, categories: ['综艺'] }), { fetch }).home(false);
    expect(result.list).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('category sends ac=videolist, t and pg', async () => {
    const fetch = mockFetch(XML_SEARCH);
    const result = await new CmsProvider(xmlSite, { fetch }).category('1', '2', true, { year: '2026' });

    expect(query(fetch)).toEqual({ ac: 'videolist', t: '1', pg: '2' });
    expect(result.page).toBe(2);
    expect(result.pagecount).toBe(3);
    expect(result.limit).toBe(1);
    expect(result.total).toBe(3);
    expect(result.list[0]?.vod_name).toBe('流浪地球');
  });

  it('detail maps elements and folds dl/dd into play from/url', async () => {
    const fetch = mockFetch(XML_DETAIL);
    const result = await new CmsProvider(xmlSite, { fetch }).detail(['202']);

    expect(query(fetch)).toEqual({ ac: 'videolist', ids: '202' });
    expect(result.list[0]).toMatchObject({
      vod_id: '202',
      vod_name: '三体',
      type_name: '电视剧',
      vod_pic: 'https://img.example.com/202.jpg',
      vod_remarks: '全30集',
      vod_year: '2023',
      vod_area: '大陆',
      vod_director: '杨磊',
      vod_actor: '张鲁一,于和伟',
      vod_content: '<p>地球文明与三体文明的故事。</p>',
      vod_play_from: 'm3u8$$$yun',
      vod_play_url:
        '第01集$https://cdn.example.com/1.m3u8#第02集$https://cdn.example.com/2.m3u8$$$第01集$https://share.example.com/1.html',
    });
  });

  it('search sends wd, quick, extend and pg only past page 1', async () => {
    const fetch = mockFetch(XML_SEARCH, XML_SEARCH);
    const provider = new CmsProvider(xmlSite, { fetch });

    const first = await provider.search('流浪', false);
    await provider.search('流浪', true, '2');

    expect(query(fetch, 0)).toEqual({ wd: '流浪', quick: 'false', extend: '' });
    expect(query(fetch, 1)).toEqual({ wd: '流浪', quick: 'true', extend: '', pg: '2' });
    expect(first.list.map((v) => v.vod_id)).toEqual(['303']);
  });

  it('returns an empty result for malformed XML', () => {
    expect(parseXmlResult('<rss><list><video>').list).toEqual([]);
    expect(parseXmlResult('not xml').class).toEqual([]);
  });
});

describe('type 1 (JSON)', () => {
  const jsonSite = site({ type: 1 });

  it('home attaches filters to classes', async () => {
    const fetch = mockFetch(JSON.stringify(home));
    const result = await new CmsProvider(jsonSite, { fetch }).home(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.class.map((c) => c.filters.map((f) => f.key))).toEqual([['year'], ['area'], []]);
    expect(result.class[0]?.filters[0]?.value).toEqual([
      { n: '全部', v: '' },
      { n: '2026', v: '2026' },
    ]);
    expect(result.list[0]?.vod_name).toBe('电影A');
  });

  it('category sends f as JSON of extend and normalises string paging', async () => {
    const fetch = mockFetch(JSON.stringify(category));
    const result = await new CmsProvider(jsonSite, { fetch }).category('1', '2', true, { year: '2026', area: '大陆' });

    expect(query(fetch)).toEqual({ f: '{"year":"2026","area":"大陆"}', ac: 'detail', t: '1', pg: '2' });
    expect(result.page).toBe(2);
    expect(result.pagecount).toBe(5);
    expect(result.limit).toBe(20);
    expect(result.total).toBe(100);
    expect(result.list[0]?.vod_id).toBe('21');
  });

  it('category omits f for an empty extend', async () => {
    const fetch = mockFetch(JSON.stringify(category));
    await new CmsProvider(jsonSite, { fetch }).category('1', '1', false, {});
    expect(query(fetch)).toEqual({ ac: 'detail', t: '1', pg: '1' });
  });

  it('detail joins ids and parses play sources', async () => {
    const fetch = mockFetch(JSON.stringify(detail));
    const result = await new CmsProvider(jsonSite, { fetch }).detail(['21', '22']);

    expect(query(fetch)).toEqual({ ac: 'detail', ids: '21,22' });
    expect(result.list[0]?.vod_play_from).toBe('m3u8$$$yun');
  });

  it('search sends params and site.ext as extend', async () => {
    const fetch = mockFetch(JSON.stringify(category));
    await new CmsProvider(site({ type: 1, ext: 'token' }), { fetch }).search('电影', true);
    expect(query(fetch)).toEqual({ wd: '电影', quick: 'true', extend: 'token' });
  });

  it('returns an empty result for malformed JSON', async () => {
    const result = await new CmsProvider(jsonSite, { fetch: mockFetch('<html>') }).detail(['1']);
    expect(result.list).toEqual([]);
  });
});

describe('site.ext', () => {
  it('is sent as extend in the query when short', async () => {
    const fetch = mockFetch(JSON.stringify(category));
    await new CmsProvider(site({ type: 1, ext: 'abc' }), { fetch }).category('1', '1', false, {});
    expect(query(fetch).extend).toBe('abc');
    expect(fetch.mock.calls[0]?.[1]?.method).toBeUndefined();
  });

  it('switches to a POST form body above 1000 chars', async () => {
    const ext = 'x'.repeat(1001);
    const fetch = mockFetch(JSON.stringify(detail));
    const cms = site({ type: 1, ext, header: { Referer: 'https://r/' } });
    await new CmsProvider(cms, { fetch }).detail(['21']);

    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(cms.api);
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded', Referer: 'https://r/' });
    expect(new URLSearchParams(String(init?.body)).get('extend')).toBe(ext);
    expect(new URLSearchParams(String(init?.body)).get('ids')).toBe('21');
  });
});

describe('player', () => {
  it('returns the episode url with parse 0 for direct media', async () => {
    const provider = new CmsProvider(site({ type: 1, header: { 'User-Agent': 'ua' } }));
    const result = await provider.player('m3u8', 'https://cdn.example.com/21.m3u8', []);

    expect(result.url.values).toEqual([{ n: '', v: 'https://cdn.example.com/21.m3u8' }]);
    expect(result).toMatchObject({ key: 'cms', flag: 'm3u8', parse: 0, playUrl: '', header: { 'User-Agent': 'ua' } });
  });

  it('needs parsing for web pages or when the site has a playUrl', async () => {
    const plain = new CmsProvider(site({ type: 1 }));
    expect((await plain.player('yun', 'https://share.example.com/21.html', [])).parse).toBe(1);

    const withPlayUrl = new CmsProvider(site({ type: 1, playUrl: 'https://jx.example.com/?url=' }));
    const result = await withPlayUrl.player('m3u8', 'https://cdn.example.com/21.m3u8', []);
    expect(result.parse).toBe(1);
    expect(result.playUrl).toBe('https://jx.example.com/?url=');
  });

  it('isVideoFormat follows the Sniffer pattern', () => {
    expect(isVideoFormat('https://cdn.example.com/a/b.mp4?t=1')).toBe(true);
    expect(isVideoFormat('rtmp://live.example.com/x')).toBe(true);
    expect(isVideoFormat('https://jx.example.com/?url=https://cdn.example.com/a.m3u8')).toBe(false);
    expect(isVideoFormat('https://v.example.com/play/1.html')).toBe(false);
  });
});
