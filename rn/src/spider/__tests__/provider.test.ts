/**
 * JsSpiderProvider end to end: fixture spiders run in NodeSpiderRuntime
 * (node `vm`, see __testutils__/nodeRuntime.ts) with the real prelude and
 * the bundled libs; spider sources come from a mocked fetch.
 */

import { parseSite } from '../../core/config/vodConfig';
import type { FetchLike } from '../../core/http';
import { getProvider, resetProviderRegistry, UnsupportedSiteError } from '../../core/provider';
import type { JsonObject, Site } from '../../core/types';
import {
  BAD_SPIDER,
  CAT_SPIDER,
  COUNTER_SPIDER,
  FIXTURE_SPIDER,
  FLAKY_SPIDER,
  GLOBAL_SPIDER,
  HELPER_SPIDER,
  SLOW_SPIDER,
} from '../__fixtures__/spiders';
import { type HostHttp, NodeSpiderRuntime } from '../__testutils__/nodeRuntime';
import {
  DEFAULT_SPIDER_TIMEOUT,
  JsSpiderProvider,
  jsSpiderProviderFactory,
  registerJsSpiderProvider,
  setSpiderRuntime,
  SpiderError,
  SpiderTimeoutError,
} from '..';

type MockFetch = jest.Mock<Promise<Response>, [string, RequestInit?]> & FetchLike;

/** Serves spider sources by URL; a number answers with that HTTP status. */
function sources(map: Record<string, string | number | (string | number)[]>): MockFetch {
  const counts = new Map<string, number>();
  return jest.fn(async (url: string) => {
    const entry = map[url] ?? 404;
    const index = counts.get(url) ?? 0;
    counts.set(url, index + 1);
    const value = Array.isArray(entry) ? (entry[Math.min(index, entry.length - 1)] ?? 404) : entry;
    const status = typeof value === 'number' ? value : 200;
    const body = typeof value === 'string' ? value : '';
    return { ok: status < 400, status, url, text: async () => body } as Response;
  }) as MockFetch;
}

function site(key: string, api: string, json: JsonObject = {}): Site {
  return parseSite({ key, name: key, type: 3, api, ...json });
}

const HOME_JSON = JSON.stringify({
  class: [
    { type_id: '1', type_name: 'Movies' },
    { type_id: '2', type_name: 'Series' },
  ],
  filters: { '1': [{ key: 'year', name: 'Year', value: [{ n: '2024', v: '2024' }] }] },
});

const hostHttp = jest.fn<ReturnType<HostHttp>, Parameters<HostHttp>>((url: string) => {
  if (url === 'https://fixture.example.com/api/home.json') return { code: 200, content: HOME_JSON };
  if (url.startsWith('https://fixture.example.com/detail?id=')) {
    const id = url.slice(url.indexOf('=') + 1);
    return { code: 200, content: JSON.stringify({ vod_id: id, vod_name: `Vod ${id}`, vod_play_from: 'a$$$b', vod_play_url: '1$u1$$$2$u2' }) };
  }
  return { code: '', content: '' };
});

let runtime: NodeSpiderRuntime;

beforeEach(() => {
  hostHttp.mockClear();
  runtime = new NodeSpiderRuntime({ http: hostHttp });
  setSpiderRuntime(runtime);
});

afterEach(() => {
  setSpiderRuntime(undefined);
  resetProviderRegistry();
});

describe('JsSpiderProvider with the fixture spider', () => {
  const api = 'https://spiders.example.com/fixture.js';
  const fixtureSite = site('fx', api, { ext: { token: 't1' }, header: { 'User-Agent': 'tvbox-test' }, categories: ['Series', 'Movies'] });

  function create() {
    const fetch = sources({ [api]: FIXTURE_SPIDER });
    return { fetch, provider: new JsSpiderProvider(fixtureSite, { fetch }) };
  }

  it('init loads the source with the site header and passes a JSON object ext as an object', async () => {
    const { fetch, provider } = create();
    await provider.init();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]?.[0]).toBe(api);
    expect(fetch.mock.calls[0]?.[1]?.headers).toEqual({ 'User-Agent': 'tvbox-test' });
    expect(JSON.parse(runtime.store.get('cache_fixture_ext') ?? '')).toEqual({ token: 't1' });
  });

  it('init is lazy and memoised', async () => {
    const { fetch, provider } = create();
    expect(runtime.contexts.size).toBe(0);
    await Promise.all([provider.homeVideo(), provider.search('a', false)]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(runtime.contexts.size).toBe(1);
  });

  it('home calls "home" through req/joinUrl, then attaches filters and orders classes', async () => {
    const { provider } = create();
    const result = await provider.home(true);
    expect(hostHttp).toHaveBeenCalledWith('https://fixture.example.com/api/home.json', expect.objectContaining({ headers: { 'X-Filter': 'true' } }));
    expect(result.class.map((c) => c.type_name)).toEqual(['Series', 'Movies']);
    expect(result.class[1]?.filters.map((f) => f.key)).toEqual(['year']);
  });

  it('homeVideo calls "homeVod" and accepts an object result', async () => {
    const { provider } = create();
    const result = await provider.homeVideo();
    expect(result.list).toEqual([expect.objectContaining({ vod_id: 'hv1', vod_name: 'Home video', vod_pic: 'https://fixture.example.com/a/img.jpg' })]);
  });

  it('category passes tid, page, filter and extend', async () => {
    const { provider } = create();
    const result = await provider.category('5', '2', true, { area: 'US' });
    expect(result.page).toBe(2);
    expect(result.pagecount).toBe(9);
    expect(result.list[0]).toEqual(expect.objectContaining({ vod_id: '5-2', vod_name: 'true', vod_remarks: '{"area":"US"}' }));
  });

  it('detail calls "detail" with the first id and the async http helper', async () => {
    const { provider } = create();
    const result = await provider.detail(['42', '43']);
    expect(result.list).toHaveLength(1);
    expect(result.list[0]).toEqual(
      expect.objectContaining({ vod_id: '42', vod_name: 'Vod 42', vod_play_from: 'a$$$b', vod_remarks: '{"token":"t1"}' }),
    );
  });

  it('search passes the page only after the first page', async () => {
    const { provider } = create();
    expect((await provider.search('k', true)).list[0]?.vod_name).toBe('true:none');
    expect((await provider.search('k', false, '3')).list[0]?.vod_name).toBe('false:3');
  });

  it('player calls "play" and fills flag, site header and key', async () => {
    const { provider } = create();
    const result = await provider.player('line1', 'ep1', ['qq', 'iqiyi']);
    expect(result.url.values).toEqual([{ n: '', v: 'ep1#qq,iqiyi' }]);
    expect(result.parse).toBe(0);
    expect(result.flag).toBe('line1');
    expect(result.header).toEqual({ 'User-Agent': 'tvbox-test' });
    expect(result.key).toBe('fx');
    expect((await provider.player('own', 'ep2', [])).header).toEqual({ Referer: 'https://fixture.example.com' });
  });

  it('destroy calls "destroy", releases the context and rejects later calls', async () => {
    const { provider } = create();
    await provider.init();
    await provider.destroy();
    expect(runtime.store.get('cache_fixture_destroyed')).toBe('true');
    expect(runtime.contexts.size).toBe(0);
    await expect(provider.home(false)).rejects.toMatchObject({ code: 'ERR_SPIDER_DESTROYED' });
  });

  it('destroy before init does nothing', async () => {
    const { fetch, provider } = create();
    await provider.destroy();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('spider formats', () => {
  it('cat-style spiders get { stype: 3, skey, ext } in init', async () => {
    const api = 'https://spiders.example.com/cat.js';
    const fetch = sources({ [api]: CAT_SPIDER });
    const result = await new JsSpiderProvider(site('catkey', api, { ext: 'plain-ext' }), { fetch }).home(false);
    expect(result.class[0]?.type_name).toBe('catkey:3:"plain-ext"');

    const objectExt = await new JsSpiderProvider(site('cat2', api, { ext: { a: 1 } }), { fetch }).home(false);
    expect(objectExt.class[0]?.type_name).toBe('cat2:3:{"a":1}');
  });

  it('rewrites __JS_SPIDER__ to globalThis.__JS_SPIDER__', async () => {
    const api = 'https://spiders.example.com/global.js';
    const result = await new JsSpiderProvider(site('g', api), { fetch: sources({ [api]: GLOBAL_SPIDER }) }).home(false);
    expect(result.class[0]?.type_name).toBe('global');
  });

  it('loads crypto-js and the pd parser when the spider uses them', async () => {
    const api = 'https://spiders.example.com/helper.js';
    const result = await new JsSpiderProvider(site('h', api), { fetch: sources({ [api]: HELPER_SPIDER }) }).home(false);
    expect(result.list.map((v) => [v.vod_id, v.vod_name])).toEqual([
      ['https://h.example.com/v/1', 'One'],
      ['https://h.example.com/v/2', 'Two'],
    ]);
    // md5("One")
    expect(result.list[0]?.vod_remarks).toBe('06c2cea18679d64399783748fa367bdd');
  });

  it('two sites do not share globals', async () => {
    const api = 'https://spiders.example.com/counter.js';
    const fetch = sources({ [api]: COUNTER_SPIDER });
    const a = new JsSpiderProvider(site('a', api), { fetch });
    const b = new JsSpiderProvider(site('b', api), { fetch });
    await a.homeVideo();
    expect((await a.home(false)).list[0]).toEqual(expect.objectContaining({ vod_id: '1', vod_name: 'string' }));
    expect((await b.home(false)).list[0]).toEqual(expect.objectContaining({ vod_id: '1', vod_name: 'undefined' }));
    expect(runtime.contexts.size).toBe(2);
  });
});

describe('errors', () => {
  const api = 'https://spiders.example.com/bad.js';
  const bad = () => new JsSpiderProvider(site('bad', api), { fetch: sources({ [api]: BAD_SPIDER }) });

  it('spider exceptions reject with SpiderError ERR_QUICKJS_EXCEPTION', async () => {
    const error = await bad()
      .home(true)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SpiderError);
    expect(error).toMatchObject({ code: 'ERR_QUICKJS_EXCEPTION' });
    expect((error as Error).message).toContain('home exploded');
  });

  it('garbage results become empty Results', async () => {
    const provider = bad();
    for (const result of [await provider.homeVideo(), await provider.category('1', '1', false, {}), await provider.detail(['x']), await provider.search('k', false)]) {
      expect(result.list).toEqual([]);
      expect(result.class).toEqual([]);
    }
  });

  it('a promise that never settles rejects ERR_QUICKJS_STALLED', async () => {
    await expect(bad().player('f', 'id', [])).rejects.toMatchObject({ code: 'ERR_QUICKJS_STALLED' });
  });

  it('timeouts surface as SpiderTimeoutError and the context stays usable', async () => {
    const slowApi = 'https://spiders.example.com/slow.js';
    const slowSite = { ...site('slow', slowApi), timeout: 100 };
    const provider = new JsSpiderProvider(slowSite, { fetch: sources({ [slowApi]: SLOW_SPIDER }) });
    await expect(provider.home(false)).rejects.toBeInstanceOf(SpiderTimeoutError);
    await expect(provider.homeVideo()).rejects.toBeInstanceOf(SpiderTimeoutError);
    expect((await provider.category('c', '1', false, {})).list[0]?.vod_name).toBe('after timeout');
  });

  it('uses the default timeout when the site has none', () => {
    expect(new JsSpiderProvider({ ...site('t', 'https://x/a.js'), timeout: 0 }).timeout).toBe(DEFAULT_SPIDER_TIMEOUT);
    expect(new JsSpiderProvider(site('t', 'https://x/a.js', { timeout: 5 })).timeout).toBe(5000);
  });

  it('a failed source download is retried on the next call', async () => {
    const flakyApi = 'https://spiders.example.com/fixture.js';
    const fetch = sources({ [flakyApi]: [500, FIXTURE_SPIDER] });
    const provider = new JsSpiderProvider(site('f', flakyApi), { fetch });
    await expect(provider.homeVideo()).rejects.toMatchObject({ code: 'ERR_SPIDER_LOAD' });
    expect(runtime.contexts.size).toBe(0);
    expect((await provider.homeVideo()).list[0]?.vod_id).toBe('hv1');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('an init exception is retried on a fresh context', async () => {
    const flakyApi = 'https://spiders.example.com/flaky.js';
    const provider = new JsSpiderProvider(site('fl', flakyApi), { fetch: sources({ [flakyApi]: FLAKY_SPIDER }) });
    await expect(provider.home(false)).rejects.toMatchObject({ code: 'ERR_QUICKJS_EXCEPTION', message: expect.stringContaining('init failed once') });
    expect(runtime.contexts.size).toBe(0);
    expect((await provider.home(false)).class[0]?.type_name).toBe('recovered');
    expect(runtime.contexts.size).toBe(1);
  });

  it('a module without a spider export fails init with a clear message', async () => {
    const emptyApi = 'https://spiders.example.com/empty.js';
    const provider = new JsSpiderProvider(site('e', emptyApi), { fetch: sources({ [emptyApi]: 'export const x = 1;' }) });
    await expect(provider.home(false)).rejects.toMatchObject({ message: expect.stringContaining('exported no object') });
  });

  it('throws a clear error when no runtime is installed', () => {
    setSpiderRuntime(undefined);
    expect(() => new JsSpiderProvider(site('n', 'https://x/a.js'))).toThrow(/setSpiderRuntime/);
  });
});

describe('registration', () => {
  it('matches type 3 .js sites only', () => {
    expect(jsSpiderProviderFactory.match(site('a', 'https://x/a.js?v=1'))).toBe(true);
    expect(jsSpiderProviderFactory.match(site('b', 'csp_Demo'))).toBe(false);
    expect(jsSpiderProviderFactory.match(site('c', 'https://x/a.py'))).toBe(false);
    expect(jsSpiderProviderFactory.match(parseSite({ key: 'd', type: 1, api: 'https://x/a.js' }))).toBe(false);
  });

  it('registerJsSpiderProvider adds the factory and returns the unregister function', () => {
    const jsSite = site('js', 'https://x/a.js');
    expect(() => getProvider(jsSite)).toThrow(UnsupportedSiteError);
    const unregister = registerJsSpiderProvider();
    expect(getProvider(jsSite)).toBeInstanceOf(JsSpiderProvider);
    unregister();
    expect(() => getProvider(site('js2', 'https://x/b.js'))).toThrow(UnsupportedSiteError);
  });
});
