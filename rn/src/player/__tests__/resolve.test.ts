import { parseSite } from '../../core/config/vodConfig';
import type { FetchLike } from '../../core/http';
import type { SiteProvider } from '../../core/provider';
import { normalizeParse, normalizeResult, type JsonObject, type Parse, type Site } from '../../core/types';
import {
  loadVod,
  MSG_PARSE_FAILED,
  MSG_WEB_PARSE,
  PlaybackError,
  type ResolveDeps,
  resolvePlayer,
  runParse,
  withUserAgent,
} from '../resolve';

const LONG = 'https://cdn.example.com/video/0123456789abcdef/index.m3u8';

const site: Site = parseSite({ key: 'cms', name: 'CMS', type: 1, api: 'https://cms.example.com/api', header: { Referer: 'https://site/' } });

function provider(result: JsonObject, detail: JsonObject = {}): SiteProvider & { player: jest.Mock } {
  return {
    site,
    home: jest.fn(),
    homeVideo: jest.fn(),
    category: jest.fn(),
    search: jest.fn(),
    detail: jest.fn(async () => normalizeResult(detail)),
    player: jest.fn(async () => normalizeResult(result)),
  };
}

/** Fetch answering by URL prefix; unmatched URLs fail with 404. */
function fetchBy(routes: Record<string, unknown>): jest.Mock & FetchLike {
  return jest.fn(async (url: string) => {
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (key === undefined) return { ok: false, status: 404, url, text: async () => '' } as Response;
    const body = routes[key];
    return { ok: true, status: 200, url, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) } as Response;
  });
}

const parse = (json: JsonObject): Parse => normalizeParse(json);
const superParse = parse({ name: '超级解析', type: 4 });

function deps(overrides: Partial<ResolveDeps> & { result?: JsonObject } = {}): ResolveDeps {
  const { result = {}, ...rest } = overrides;
  const p = provider(result);
  return { config: { parses: [], flags: [] }, ua: '', getProvider: () => p, ...rest };
}

describe('resolvePlayer', () => {
  it('plays a direct URL with playUrl prefix, merged headers and the UA setting', async () => {
    const d = deps({
      ua: 'MyUA',
      result: { url: 'a.m3u8', playUrl: 'https://p/', header: { referer: 'https://r/' }, parse: 0, subs: [{ url: 's.srt', name: '中文', lang: 'zh' }] },
    });
    const decision = await resolvePlayer(site, 'line', 'id', d);
    expect(decision).toEqual({
      type: 'direct',
      media: {
        url: 'https://p/a.m3u8',
        headers: { referer: 'https://r/', 'User-Agent': 'MyUA' },
        format: undefined,
        subtitles: [{ url: 's.srt', name: '中文', lang: 'zh', format: undefined }],
        position: undefined,
      },
    });
  });

  it('keeps an explicit User-Agent', () => {
    expect(withUserAgent({ 'user-agent': 'x' }, 'MyUA')).toEqual({ 'user-agent': 'x' });
    expect(withUserAgent({}, '')).toEqual({});
  });

  it('picks the multi-value url at its position and passes Result.position', async () => {
    const d = deps({ result: { url: { values: [{ n: 'SD', v: 'http://sd' }, { n: 'HD', v: 'http://hd' }], position: 1 }, position: 9000 } });
    const decision = await resolvePlayer(site, 'line', 'id', d);
    expect(decision.type === 'direct' && decision.media).toMatchObject({ url: 'http://hd', position: 9000, headers: { Referer: 'https://site/' } });
  });

  it('throws the result message', async () => {
    await expect(resolvePlayer(site, 'line', 'id', deps({ result: { msg: '版权限制', code: 0 } }))).rejects.toThrow('版权限制');
  });

  it('asks for a parse when parse = 1, using the selected parser for VIP flags', async () => {
    const jx = parse({ name: 'jx', type: 1, url: 'https://jx/?url=' });
    const d = deps({ config: { parses: [superParse, jx], parse: jx, flags: ['qq'] }, result: { url: 'https://v.qq.com/x', parse: 1 } });
    const decision = await resolvePlayer(site, 'qq', 'id', d);
    expect(decision).toMatchObject({ type: 'parse', job: { parse: jx, webUrl: 'https://v.qq.com/x', flag: 'qq' } });
  });

  it('reads json: and parse: playUrl prefixes', async () => {
    const named = parse({ name: 'named', type: 1, url: 'https://named/?u=' });
    const config = { parses: [superParse, named], parse: superParse, flags: [] };
    const json = await resolvePlayer(site, 'f', 'id', deps({ config, result: { url: 'x', parse: 1, playUrl: 'json:https://j/?u=' } }));
    expect(json).toMatchObject({ type: 'parse', job: { parse: { type: 1, url: 'https://j/?u=' } } });
    const byName = await resolvePlayer(site, 'f', 'id', deps({ config, result: { url: 'x', parse: 1, playUrl: 'parse:named' } }));
    expect(byName).toMatchObject({ type: 'parse', job: { parse: named } });
    const web = await resolvePlayer(site, 'f', 'id', deps({ config, result: { url: 'x', parse: 1, playUrl: '' } }));
    expect(web).toMatchObject({ type: 'parse', job: { parse: { type: 0 } } });
  });

  it('takes the click script from the site, else from the result', async () => {
    const clickSite = parseSite({ key: 'c', name: 'C', type: 1, api: 'https://c/api', click: 'site()' });
    const fromSite = await resolvePlayer(clickSite, 'f', 'id', deps({ result: { url: 'https://share/x', parse: 1, click: 'result()' } }));
    expect(fromSite).toMatchObject({ type: 'parse', job: { parse: { type: 0, url: '' }, webUrl: 'https://share/x', click: 'site()' } });
    const fromResult = await resolvePlayer(site, 'f', 'id', deps({ result: { url: 'https://share/x', parse: 1, click: 'result()' } }));
    expect(fromResult).toMatchObject({ type: 'parse', job: { click: 'result()' } });
    const none = await resolvePlayer(site, 'f', 'id', deps({ result: { url: 'https://share/x', parse: 1 } }));
    expect(none.type === 'parse' && 'click' in none.job).toBe(false);
  });
});

describe('runParse', () => {
  const job = (p: Parse) => ({ parse: p, webUrl: 'https://v.qq.com/x', flag: 'qq', headers: { Referer: 'https://site/' }, subtitles: [] });

  it('json parse (type 1) takes url and header fields from the response', async () => {
    const fetch = fetchBy({ 'https://jx/?url=https://v.qq.com/x': { code: 200, data: { url: LONG }, 'User-Agent': 'jxUA', referer: 'https://jx/' } });
    const p = parse({ name: 'jx', type: 1, url: 'https://jx/?url=', ext: { header: { Cookie: 'c' } } });
    const media = await runParse(job(p), deps({ fetch, ua: 'MyUA' }));
    expect(media).toMatchObject({ url: LONG, headers: { 'User-Agent': 'jxUA', Referer: 'https://jx/' }, from: 'jx' });
    expect((fetch.mock.calls[0]![1] as RequestInit).headers).toEqual({ Cookie: 'c' });
  });

  it('falls back to the parser / result headers and adds the UA', async () => {
    const fetch = fetchBy({ 'https://jx/': { url: LONG } });
    const media = await runParse(job(parse({ name: 'jx', type: 1, url: 'https://jx/' })), deps({ fetch, ua: 'MyUA' }));
    expect(media.headers).toEqual({ Referer: 'https://site/', 'User-Agent': 'MyUA' });
    expect((fetch.mock.calls[0]![1] as RequestInit).headers).toEqual({ Referer: 'https://site/' });
  });

  it('fails a short url or a bad response', async () => {
    const fetch = fetchBy({ 'https://jx/': { url: 'http://short' } });
    await expect(runParse(job(parse({ type: 1, url: 'https://jx/' })), deps({ fetch }))).rejects.toThrow(MSG_PARSE_FAILED);
    await expect(runParse(job(parse({ type: 1, url: 'https://none/' })), deps({ fetch }))).rejects.toThrow(MSG_PARSE_FAILED);
  });

  it('rejects web parsing without a sniffer', async () => {
    await expect(runParse(job(parse({ type: 0, url: 'https://web/' })), deps())).rejects.toEqual(new PlaybackError(MSG_WEB_PARSE));
  });

  it('sniffs parser url + page url (type 0) with the click script and keeps the job fields', async () => {
    const sniff = jest.fn(async () => ({ url: LONG, headers: { Referer: 'https://web/' }, subtitles: [] }));
    const sub = { url: 's.srt', name: 'zh' };
    const spec = { ...job(parse({ name: 'web', type: 0, url: 'https://web/?url=' })), click: 'go()', format: 'hls', subtitles: [sub], position: 5 };
    const media = await runParse(spec, deps({ sniff, ua: 'MyUA' }));
    expect(sniff).toHaveBeenCalledWith({
      url: 'https://web/?url=https://v.qq.com/x',
      headers: { Referer: 'https://site/', 'User-Agent': 'MyUA' },
      click: 'go()',
    });
    expect(media).toEqual({ url: LONG, headers: { Referer: 'https://web/' }, format: 'hls', subtitles: [sub], position: 5, from: 'web' });
  });

  it('sniffs the page url itself for a type 0 parser without url, preferring the parser headers', async () => {
    const sniff = jest.fn(async () => ({ url: LONG, headers: {}, subtitles: [] }));
    await runParse(job(parse({ type: 0, url: '', ext: { header: { Cookie: 'c' } } })), deps({ sniff }));
    expect(sniff).toHaveBeenCalledWith({ url: 'https://v.qq.com/x', headers: { Cookie: 'c' }, click: undefined });
  });

  it('passes sniff failures through', async () => {
    const sniff = jest.fn(async () => Promise.reject(new PlaybackError(MSG_PARSE_FAILED)));
    await expect(runParse(job(parse({ type: 0, url: 'https://web/' })), deps({ sniff }))).rejects.toEqual(new PlaybackError(MSG_PARSE_FAILED));
  });

  it('super parse (type 4) races the JSON parsers for the flag', async () => {
    const a = parse({ name: 'a', type: 1, url: 'https://a/', ext: { flag: ['qq'] } });
    const b = parse({ name: 'b', type: 1, url: 'https://b/', ext: { flag: ['qq'] } });
    const other = parse({ name: 'c', type: 1, url: 'https://c/', ext: { flag: ['youku'] } });
    const fetch = fetchBy({ 'https://b/': { url: LONG }, 'https://c/': { url: `${LONG}?c` } });
    const config = { parses: [superParse, a, b, other], parse: superParse, flags: [] };
    const media = await runParse(job(superParse), deps({ fetch, config }));
    expect(media).toMatchObject({ url: LONG, from: 'b' });
    expect(fetch.mock.calls.map(([url]) => url as string).some((url) => url.startsWith('https://c/'))).toBe(false);
  });

  it('super parse fails when every parser fails', async () => {
    const config = { parses: [superParse, parse({ name: 'a', type: 1, url: 'https://a/' })], parse: superParse, flags: [] };
    await expect(runParse(job(superParse), deps({ fetch: fetchBy({}), config }))).rejects.toThrow(MSG_PARSE_FAILED);
  });

  it('extended parsers (type 2/3) try the JSON parsers in order', async () => {
    const a = parse({ name: 'a', type: 1, url: 'https://a/' });
    const b = parse({ name: 'b', type: 1, url: 'https://b/' });
    const fetch = fetchBy({ 'https://b/': { url: LONG } });
    const config = { parses: [superParse, a, b], parse: superParse, flags: [] };
    const media = await runParse(job(parse({ name: 'ext', type: 2, url: 'https://ext/' })), deps({ fetch, config }));
    expect(media.from).toBe('b');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(['https://a/https://v.qq.com/x', 'https://b/https://v.qq.com/x']);
  });
});

describe('loadVod', () => {
  it('returns the vod with its non-empty flags', async () => {
    const p = provider({}, { list: [{ vod_id: '1', vod_name: 'Show', vod_play_from: 'a$$$b', vod_play_url: 'E1$u1#E2$u2$$$E1$v1' }] });
    const { vod, flags } = await loadVod(site, '1', { getProvider: () => p });
    expect(vod.vod_name).toBe('Show');
    expect(flags.map((flag) => flag.flag)).toEqual(['a', 'b']);
    expect(p.detail).toHaveBeenCalledWith(['1']);
  });

  it('fails without a vod', async () => {
    await expect(loadVod(site, '1', { getProvider: () => provider({}, { list: [] }) })).rejects.toThrow('暂无播放数据');
  });
});
