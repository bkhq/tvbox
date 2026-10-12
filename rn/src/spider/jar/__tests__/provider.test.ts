import { parseSite, setJarSitesSupported } from '../../../core/config/vodConfig';
import type { JsonObject } from '../../../core/types';
import { SpiderError, SpiderTimeoutError } from '../../runtime';
import { coded, mockJarSpider } from '../__testutils__/mockNative';
import { createJarSpiderProviderFactory, JarSpiderProvider } from '../provider';

const JAR = 'https://x/spider.jar;md5;abc';

function jarSite(json: JsonObject = {}) {
  return parseSite({ key: 'bili', name: 'Bili', type: 3, api: 'csp_Bili', ext: 'e', header: { Referer: 'https://r/' }, ...json }, JAR);
}

afterEach(() => setJarSitesSupported(false));

describe('createJarSpiderProviderFactory', () => {
  it('matches type 3 csp_ sites with a jar when the module is available', () => {
    const factory = createJarSpiderProviderFactory(mockJarSpider());
    expect(factory.id).toBe('jar-spider');
    expect(factory.match(jarSite())).toBe(true);
    expect(factory.match(parseSite({ key: 'a', type: 3, api: 'csp_A' }))).toBe(false);
    expect(factory.match(parseSite({ key: 'a', type: 3, api: 'https://x/a.js' }, JAR))).toBe(false);
    expect(factory.match(parseSite({ key: 'a', type: 1, api: 'csp_A' }, JAR))).toBe(false);
  });

  it('matches nothing without the native module (iOS / tvOS)', () => {
    expect(createJarSpiderProviderFactory(null).match(jarSite())).toBe(false);
    expect(createJarSpiderProviderFactory().match(jarSite())).toBe(false);
  });
});

describe('JarSpiderProvider', () => {
  it('inits the spider once and sets the recent jar before each call', async () => {
    const native = mockJarSpider();
    native.homeContent.mockResolvedValue(JSON.stringify({ class: [{ type_id: '1', type_name: '电影' }], filters: { 1: [{ key: 'y', name: '年份', value: [] }] } }));
    native.searchContent.mockResolvedValue(JSON.stringify({ list: [{ vod_id: 'v', vod_name: '片' }] }));
    const provider = new JarSpiderProvider(jarSite(), native);
    const home = await provider.home(true);
    const search = await provider.search('片', false);
    expect(native.initSpider).toHaveBeenCalledTimes(1);
    expect(native.initSpider).toHaveBeenCalledWith('bili', 'csp_Bili', 'e', JAR);
    expect(native.setRecent).toHaveBeenCalledTimes(2);
    expect(native.setRecent).toHaveBeenCalledWith(JAR);
    expect(native.homeContent).toHaveBeenCalledWith('bili', true);
    expect(native.searchContent).toHaveBeenCalledWith('bili', '片', false, '1');
    expect(home.class[0]).toMatchObject({ type_id: '1', type_name: '电影', filters: [{ key: 'y' }] });
    expect(search.list[0]).toMatchObject({ vod_id: 'v', vod_name: '片' });
  });

  it('maps the other calls onto the native contract', async () => {
    const native = mockJarSpider();
    const provider = new JarSpiderProvider(jarSite(), native);
    await provider.homeVideo();
    await provider.category('1', '2', true, { y: '2024' });
    await provider.detail(['a', 'b']);
    await provider.search('k', true, '3');
    expect(native.homeVideoContent).toHaveBeenCalledWith('bili');
    expect(native.categoryContent).toHaveBeenCalledWith('bili', '1', '2', true, '{"y":"2024"}');
    expect(native.detailContent).toHaveBeenCalledWith('bili', '["a","b"]');
    expect(native.searchContent).toHaveBeenCalledWith('bili', 'k', true, '3');
  });

  it('turns empty or invalid spider output into an empty Result', async () => {
    const native = mockJarSpider();
    native.detailContent.mockResolvedValue('not json');
    const provider = new JarSpiderProvider(jarSite(), native);
    expect((await provider.homeVideo()).list).toEqual([]);
    expect((await provider.detail(['a'])).list).toEqual([]);
  });

  it('fills flag, site header and key on player results', async () => {
    const native = mockJarSpider();
    native.playerContent.mockResolvedValueOnce(JSON.stringify({ url: 'https://v/a.m3u8', parse: 0 }));
    native.playerContent.mockResolvedValueOnce(JSON.stringify({ url: 'u', flag: 'f2', header: { UA: 'x' } }));
    const provider = new JarSpiderProvider(jarSite(), native);
    const first = await provider.player('qq', 'id1', ['qq', 'iqiyi']);
    expect(native.playerContent).toHaveBeenCalledWith('bili', 'qq', 'id1', '["qq","iqiyi"]');
    expect(first).toMatchObject({ flag: 'qq', header: { Referer: 'https://r/' }, key: 'bili' });
    expect(await provider.player('qq', 'id2', [])).toMatchObject({ flag: 'f2', header: { UA: 'x' }, key: 'bili' });
  });

  it('maps native rejections to SpiderError and retries a failed init', async () => {
    const native = mockJarSpider();
    native.initSpider.mockRejectedValueOnce(coded('ERR_JARSPIDER_LOAD', 'no class'));
    const provider = new JarSpiderProvider(jarSite(), native);
    await expect(provider.home(false)).rejects.toMatchObject({ name: 'SpiderError', code: 'ERR_SPIDER_LOAD', message: 'no class' });
    native.homeContent.mockRejectedValueOnce(coded('ERR_JARSPIDER_CALL', 'boom'));
    await expect(provider.home(false)).rejects.toMatchObject({ code: 'ERR_SPIDER_RUNTIME', message: 'boom' });
    native.homeContent.mockRejectedValueOnce(coded('ERR_JARSPIDER_NO_SPIDER', 'gone'));
    await expect(provider.home(false)).rejects.toBeInstanceOf(SpiderError);
    expect(native.initSpider).toHaveBeenCalledTimes(2);
  });

  it('applies the site timeout', async () => {
    jest.useFakeTimers();
    try {
      const native = mockJarSpider();
      native.homeContent.mockReturnValue(new Promise(() => undefined));
      const provider = new JarSpiderProvider(jarSite({ timeout: 2 }), native);
      const pending = provider.home(false);
      const assertion = expect(pending).rejects.toBeInstanceOf(SpiderTimeoutError);
      await jest.advanceTimersByTimeAsync(2000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('destroys its spider and waits for it before a replacement inits', async () => {
    const native = mockJarSpider();
    const order: string[] = [];
    native.destroySpider.mockImplementation(async (key: string) => {
      await Promise.resolve();
      order.push(`destroy ${key}`);
    });
    native.initSpider.mockImplementation(async (key: string) => {
      order.push(`init ${key}`);
    });
    const old = new JarSpiderProvider(jarSite(), native);
    await old.init();
    const destroyed = old.destroy();
    const next = new JarSpiderProvider(jarSite(), native);
    await next.init();
    await destroyed;
    expect(order).toEqual(['init bili', 'destroy bili', 'init bili']);
    await expect(old.home(false)).rejects.toMatchObject({ code: 'ERR_SPIDER_DESTROYED' });
  });

  it('skips destroySpider when the spider was never created', async () => {
    const native = mockJarSpider();
    await new JarSpiderProvider(jarSite(), native).destroy();
    expect(native.destroySpider).not.toHaveBeenCalled();
  });

  it('passes proxy params through with the site key', async () => {
    const native = mockJarSpider();
    const response = { status: 200, mime: 'text/plain', headers: {}, body: 'b2s=' };
    native.proxy.mockResolvedValue(response);
    const provider = new JarSpiderProvider(jarSite(), native);
    await expect(provider.proxy({ do: 'ck', url: 'u' })).resolves.toBe(response);
    expect(JSON.parse(native.proxy.mock.calls[0][0] as string)).toEqual({ do: 'ck', url: 'u', siteKey: 'bili' });
  });
});
