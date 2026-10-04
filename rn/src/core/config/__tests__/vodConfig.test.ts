import type { FetchLike } from '../../http';
import vodFixture from '../__fixtures__/vod.json';
import { classifySite, loadVodConfig, parseVodConfig, SUPER_PARSE_NAME, supportedSites } from '../vodConfig';

const CONFIG_URL = 'https://config.example.com/tv/box/config.json?token=1';
const DOT = 'https://config.example.com/tv/box/';
const DOT_DOT = 'https://config.example.com/tv/';
// Pretty-printed like real configs: the Java JS_URI pattern spans whole lines.
const VOD_TEXT = JSON.stringify(vodFixture, null, 2);

function siteByKey(config: ReturnType<typeof parseVodConfig>, key: string) {
  const site = config.sites.find((item) => item.key === key);
  if (!site) throw new Error(`missing site ${key}`);
  return site;
}

function fakeFetch(routes: Record<string, string | { body: string; url?: string }>): jest.Mock & FetchLike {
  return jest.fn(async (url: string) => {
    const route = routes[url];
    if (route === undefined) return { ok: false, status: 404, url, text: async () => '' } as Response;
    const body = typeof route === 'string' ? route : route.body;
    const finalUrl = typeof route === 'string' ? url : (route.url ?? url);
    return { ok: true, status: 200, url: finalUrl, text: async () => body } as Response;
  });
}

describe('parseVodConfig', () => {
  const config = parseVodConfig(VOD_TEXT, CONFIG_URL);

  it('parses sites with Java getter defaults and drops duplicate keys', () => {
    expect(config.sites.map((site) => site.key)).toEqual([
      'cms_xml',
      'cms_json',
      'js_site',
      'js_remote',
      'jar_site',
      'py_site',
      'type4_site',
      'hidden',
    ]);
    expect(siteByKey(config, 'cms_xml')).toEqual({
      key: 'cms_xml',
      name: 'CMS XML',
      type: 0,
      api: 'https://cms.example.com/api.php/provide/vod/at/xml',
      ext: '',
      click: '',
      playUrl: '',
      searchable: 1,
      quickSearch: 1,
      changeable: 1,
      hide: 0,
      indexs: 0,
      timeout: 15000,
      categories: [],
      header: {},
      style: undefined,
      supported: true,
    });
    const json = siteByKey(config, 'cms_json');
    expect(json.name).toBe('CMS JSON');
    expect(json.searchable).toBe(0);
    expect(json.quickSearch).toBe(0);
    expect(json.timeout).toBe(10000);
    expect(json.categories).toEqual(['电影', '电视剧']);
    expect(json.header).toEqual({ 'User-Agent': 'okhttp/4.12.0' });
    expect(json.style).toEqual({ type: 'rect', ratio: 1.33 });
    expect(siteByKey(config, 'js_remote').ext).toBe('{"box":"TVBox","nums":[1,2]}');
    expect(siteByKey(config, 'hidden').hide).toBe(1);
  });

  it('resolves relative URLs against the config URL', () => {
    expect(siteByKey(config, 'js_site').api).toBe(`${DOT}lib/drpy.js?v=2`);
    expect(siteByKey(config, 'js_site').ext).toBe(`${DOT}rules/site.js`);
    expect(siteByKey(config, 'py_site').api).toBe(`${DOT}py/site.py`);
    expect(config.wallpaper).toBe(`${DOT}wallpaper.jpg`);
    expect(config.logo).toBe(`${DOT_DOT}logo.png`);
    expect(config.lives[0]?.url).toBe(`${DOT}live/live.m3u`);
  });

  it('flags JAR, Python and type 4 sites as unsupported but keeps them', () => {
    expect(siteByKey(config, 'js_site')).toMatchObject({ supported: true });
    expect(siteByKey(config, 'js_remote')).toMatchObject({ supported: true });
    expect(siteByKey(config, 'jar_site')).toMatchObject({ supported: false, unsupportedReason: 'jar' });
    expect(siteByKey(config, 'py_site')).toMatchObject({ supported: false, unsupportedReason: 'py' });
    expect(siteByKey(config, 'type4_site')).toMatchObject({ supported: false, unsupportedReason: 'type' });
    expect(supportedSites(config).map((site) => site.key)).toEqual(['cms_xml', 'cms_json', 'js_site', 'js_remote', 'hidden']);
  });

  it('selects the configured home site, else the first supported one', () => {
    expect(config.home?.key).toBe('cms_xml');
    expect(parseVodConfig(VOD_TEXT, CONFIG_URL, { home: 'js_site' }).home?.key).toBe('js_site');
    expect(parseVodConfig(VOD_TEXT, CONFIG_URL, { home: 'jar_site' }).home?.key).toBe('cms_xml');
    const onlyJar = { sites: [{ key: 'a', type: 3, api: 'csp_A' }, { key: 'b', type: 1, api: 'https://b/' }] };
    expect(parseVodConfig(JSON.stringify(onlyJar), CONFIG_URL).home?.key).toBe('b');
    expect(parseVodConfig('{"sites":[]}', CONFIG_URL).home).toBeUndefined();
  });

  it('parses parses with the super parser first', () => {
    expect(config.parses.map((parse) => parse.name)).toEqual([SUPER_PARSE_NAME, 'Json1', 'Web']);
    expect(config.parses[0]).toEqual({ name: SUPER_PARSE_NAME, type: 4, url: '', ext: { flag: [], header: {} } });
    expect(config.parses[1]).toEqual({
      name: 'Json1',
      type: 1,
      url: 'https://parse.example.com/?url=',
      ext: { flag: ['qq', 'iqiyi'], header: { 'User-Agent': 'Mozilla/5.0' } },
    });
    expect(config.parse?.name).toBe(SUPER_PARSE_NAME);
    expect(parseVodConfig(VOD_TEXT, CONFIG_URL, { parse: 'Web' }).parse?.name).toBe('Web');
    expect(parseVodConfig('{}', CONFIG_URL).parses).toEqual([]);
  });

  it('parses lives', () => {
    expect(config.lives).toHaveLength(2);
    expect(config.lives[0]).toMatchObject({
      name: '直播',
      epg: 'https://epg.example.com/?ch={name}',
      ua: 'Mozilla/5.0',
      timeout: 20000,
      boot: true,
      pass: false,
      groups: [],
      header: {},
    });
    const inline = config.lives[1];
    expect(inline?.catchup).toEqual({ type: 'append', days: '', regex: '', source: '?playseek={(b)yyyyMMddHHmmss}', replace: '' });
    expect(inline?.groups[0]?.name).toBe('新闻');
    expect(inline?.groups[0]?.channel[0]).toMatchObject({
      name: 'CCTV-1',
      number: '1',
      urls: ['http://cdn.example.com/cctv1.m3u8'],
    });
  });

  it('parses flags, rules, doh, headers, proxy, hosts, ads and notice', () => {
    expect(config.flags).toEqual(['qq', 'iqiyi', 'youku']);
    expect(config.rules).toEqual([
      { name: 'ads', hosts: ['video.example.com'], regex: ['m3u8?token='], script: [], exclude: ['preview.json'] },
    ]);
    expect(config.doh).toEqual([{ name: 'Google', url: 'https://dns.google/dns-query', ips: ['8.8.4.4', '8.8.8.8'] }]);
    expect(config.headers).toEqual([{ host: 'stream.example.com', header: { 'User-Agent': 'okhttp/3.12.13' } }]);
    expect(config.proxy).toEqual([{ name: 'proxy', hosts: ['googlevideo.com'], urls: ['http://127.0.0.1:7890'] }]);
    expect(config.hosts).toEqual(['old.cdn.example.com=new.cdn.example.com']);
    expect(config.ads).toEqual(['ads.example.com']);
    expect(config.notice).toBe('欢迎使用');
    expect(config.depot).toEqual([]);
    expect(config.url).toBe(CONFIG_URL);
  });

  it('decodes an embedded base64 payload', () => {
    // base64 of {"sites":[{"key":"k","name":"名","type":1,"api":"./api"}]}
    const text = 'GIF89a garbage ABCD1234**eyJzaXRlcyI6W3sia2V5IjoiayIsIm5hbWUiOiLlkI0iLCJ0eXBlIjoxLCJhcGkiOiIuL2FwaSJ9XX0=';
    const decoded = parseVodConfig(text, CONFIG_URL);
    expect(decoded.sites[0]).toMatchObject({ key: 'k', name: '名', api: `${DOT}api` });
  });

  it('throws the server message and rejects encrypted configs', () => {
    expect(() => parseVodConfig('{"msg":"授权失败"}', CONFIG_URL)).toThrow('授权失败');
    expect(() => parseVodConfig('2423abcdef', CONFIG_URL)).toThrow('Encrypted config is not supported');
    expect(() => parseVodConfig('', CONFIG_URL)).toThrow('Empty config');
  });
});

describe('classifySite', () => {
  it('ignores the query string when checking the extension', () => {
    expect(classifySite(3, 'https://x/a.JS?v=1#f')).toEqual({ supported: true });
    expect(classifySite(3, 'https://x/a.py?v=1')).toEqual({ supported: false, unsupportedReason: 'py' });
    expect(classifySite(3, 'csp_XYZ')).toEqual({ supported: false, unsupportedReason: 'jar' });
    expect(classifySite(2, 'https://x/')).toEqual({ supported: false, unsupportedReason: 'type' });
  });
});

describe('loadVodConfig', () => {
  it('fetches through http, expands remote arrays and resolves against the redirected URL', async () => {
    const fetch = fakeFetch({
      'https://short.example.com/c?token=1': {
        body: VOD_TEXT,
        url: CONFIG_URL,
      },
      'https://rules.example.com/rules.json': '[{"name":"remote","hosts":["r.example.com"]}]',
    });
    const config = await loadVodConfig('https://short.example.com/c?token=1', {}, { fetch });
    expect(config.url).toBe('https://short.example.com/c?token=1');
    expect(config.wallpaper).toBe(`${DOT}wallpaper.jpg`);
    expect(config.rules.map((rule) => rule.name)).toEqual(['ads', 'remote']);
  });

  it('follows a depot to its first entry', async () => {
    const fetch = fakeFetch({
      'https://depot.example.com/': '{"urls":[{"url":"https://a.example.com/a.json","name":"A"},{"url":"https://b.example.com/b.json","name":"B"}]}',
      'https://a.example.com/a.json': '{"sites":[{"key":"a","type":1,"api":"./api"}]}',
    });
    const config = await loadVodConfig('https://depot.example.com/', {}, { fetch });
    expect(config.url).toBe('https://a.example.com/a.json');
    expect(config.sites[0]?.api).toBe('https://a.example.com/api');
    expect(config.depot).toEqual([
      { url: 'https://a.example.com/a.json', name: 'A', time: 0 },
      { url: 'https://b.example.com/b.json', name: 'B', time: 0 },
    ]);
  });

  it('rejects on HTTP errors', async () => {
    await expect(loadVodConfig('https://missing.example.com/', {}, { fetch: fakeFetch({}) })).rejects.toThrow('HTTP 404');
  });
});
