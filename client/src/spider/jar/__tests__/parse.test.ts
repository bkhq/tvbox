import { normalizeParse, type JsonObject } from '../../../core/types';
import { MSG_PARSE_FAILED, type ParseJobSpec, type ResolveDeps, runParse } from '../../../player/resolve';
import { mockJarSpider } from '../__testutils__/mockNative';
import { installJarSpiders, resetJarSpidersForTest } from '../install';
import { base64UrlSafe, extUrl, jarParse, mixMap, tryJarParse } from '../parse';

const LONG = 'https://cdn.example.com/video/0123456789abcdef/index.m3u8';

const parse = (json: JsonObject) => normalizeParse(json);
const god = parse({ name: '超级解析', type: 4 });
const jx1 = parse({ name: 'jx1', type: 1, url: 'https://jx1/?url=', ext: { flag: ['qq'], header: { UA: '中' } } });
const jx2 = parse({ name: 'jx2', type: 1, url: 'https://jx2/' });
const ext = parse({ name: 'ext', type: 2, url: 'https://ext/' });
const mix = parse({ name: 'mix', type: 3, url: 'https://mix/' });
const parses = [god, jx1, jx2, ext, mix];

function job(p = ext, overrides: Partial<ParseJobSpec> = {}): ParseJobSpec {
  return { parse: p, webUrl: 'https://v.qq.com/x/1.html', flag: 'qq', headers: { Referer: 'https://player/' }, subtitles: [], ...overrides };
}

function install() {
  const native = mockJarSpider();
  installJarSpiders('android', native);
  return native;
}

afterEach(() => resetJarSpidersForTest());

describe('Parse ports', () => {
  it('base64UrlSafe encodes UTF-8 with the url-safe alphabet and padding', () => {
    expect(base64UrlSafe('中?>')).toBe('5LitPz4=');
    expect(base64UrlSafe('ab')).toBe('YWI=');
    expect(base64UrlSafe('ÿþ')).toBe('w7_Dvg==');
  });

  it('extUrl adds cat_ext only when the parser has ext and a query', () => {
    expect(extUrl(jx1)).toBe(`https://jx1/?cat_ext=${base64UrlSafe('{"flag":["qq"],"header":{"UA":"中"}}')}&url=`);
    expect(extUrl(jx2)).toBe('https://jx2/');
    expect(extUrl(parse({ type: 1, url: 'https://a/?u=', ext: {} }))).toBe('https://a/?u=');
  });

  it('mixMap', () => {
    expect(mixMap(jx2)).toEqual({ type: '1', ext: '{}', url: 'https://jx2/' });
  });
});

describe('jarParse', () => {
  it('is unavailable without the installed module', async () => {
    expect(jarParse.available()).toBe(false);
    await expect(jarParse.jsonExt(ext, parses, 'u')).rejects.toThrow();
    await expect(tryJarParse(job(), parses)).resolves.toBeUndefined();
  });

  it('jsonExt sends type 1 parsers as name -> extUrl', async () => {
    const native = install();
    native.jsonExt.mockResolvedValue('{"url":"x"}');
    expect(jarParse.available()).toBe(true);
    await expect(jarParse.jsonExt(ext, parses, 'web')).resolves.toEqual({ url: 'x' });
    const [key, jxs, url] = native.jsonExt.mock.calls[0] as [string, string, string];
    expect(key).toBe('https://ext/');
    expect(url).toBe('web');
    expect(JSON.parse(jxs)).toEqual({ jx1: extUrl(jx1), jx2: 'https://jx2/' });
    expect(Object.keys(JSON.parse(jxs))).toEqual(['jx1', 'jx2']);
  });

  it('jsonExtMix sends every parser as name -> mixMap', async () => {
    const native = install();
    await jarParse.jsonExtMix(mix, parses, 'web', 'qq');
    const [flag, key, name, jxs, url] = native.jsonExtMix.mock.calls[0] as string[];
    expect([flag, key, name, url]).toEqual(['qq', 'https://mix/', 'mix', 'web']);
    expect(Object.keys(JSON.parse(jxs!))).toEqual(['超级解析', 'jx1', 'jx2', 'ext', 'mix']);
    expect(JSON.parse(jxs!).jx1).toEqual(mixMap(jx1));
  });
});

describe('tryJarParse', () => {
  it('converts the result like ParseJob.checkResult', async () => {
    const native = install();
    native.jsonExt.mockResolvedValue(JSON.stringify({ url: LONG, header: { Cookie: 'c' }, jxFrom: 'jx2' }));
    await expect(tryJarParse(job(ext, { format: 'application/x-mpegURL', position: 5 }), parses, 'MyUA')).resolves.toEqual({
      url: LONG,
      headers: { Cookie: 'c', 'User-Agent': 'MyUA' },
      format: 'application/x-mpegURL',
      subtitles: [],
      position: 5,
      from: 'jx2',
    });
  });

  it('falls back to the parser header, then the player header', async () => {
    const native = install();
    native.jsonExtMix.mockResolvedValue(JSON.stringify({ url: 'short' }));
    expect((await tryJarParse(job(mix), parses))?.headers).toEqual({ Referer: 'https://player/' });
    const withHeader = parse({ name: 'mix', type: 3, url: 'https://mix/', ext: { header: { Referer: 'https://p/' } } });
    expect((await tryJarParse(job(withHeader), parses))?.headers).toEqual({ Referer: 'https://p/' });
    expect((await tryJarParse(job(withHeader), parses))?.from).toBeUndefined();
  });

  it('is undefined on failure, empty url, web sniffing or other parser types', async () => {
    const native = install();
    native.jsonExt.mockRejectedValueOnce(new Error('x'));
    await expect(tryJarParse(job(), parses)).resolves.toBeUndefined();
    native.jsonExt.mockResolvedValueOnce('{}');
    await expect(tryJarParse(job(), parses)).resolves.toBeUndefined();
    native.jsonExt.mockResolvedValueOnce(JSON.stringify({ url: LONG, parse: 1 }));
    await expect(tryJarParse(job(), parses)).resolves.toBeUndefined();
    await expect(tryJarParse(job(jx1), parses)).resolves.toBeUndefined();
    expect(native.jsonExt).toHaveBeenCalledTimes(3);
  });
});

describe('runParse type 2 / 3 hook', () => {
  const fallback = parse({ name: 'jx', type: 1, url: 'https://jx/' });
  const fetch = jest.fn(async (url: string) => ({ ok: true, status: 200, url, text: async () => JSON.stringify({ url: `${LONG}?fallback` }) }) as Response);
  const deps: ResolveDeps = { config: { parses: [god, fallback, ext, mix], flags: [] }, ua: '', fetch };

  beforeEach(() => fetch.mockClear());

  it('uses the JAR result first', async () => {
    const native = install();
    native.jsonExt.mockResolvedValue(JSON.stringify({ url: LONG }));
    native.jsonExtMix.mockResolvedValue(JSON.stringify({ url: LONG }));
    expect((await runParse(job(ext), deps)).url).toBe(LONG);
    expect((await runParse(job(mix), deps)).url).toBe(LONG);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to the JSON parsers when the JAR parse is unavailable or fails', async () => {
    expect((await runParse(job(ext), deps)).url).toBe(`${LONG}?fallback`);
    const native = install();
    native.jsonExtMix.mockResolvedValue('{}');
    expect((await runParse(job(mix), deps)).url).toBe(`${LONG}?fallback`);
    fetch.mockImplementation(async (url: string) => ({ ok: false, status: 404, url, text: async () => '' }) as Response);
    await expect(runParse(job(mix), deps)).rejects.toThrow(MSG_PARSE_FAILED);
  });
});
