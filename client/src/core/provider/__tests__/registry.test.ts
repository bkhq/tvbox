import { parseSite } from '../../config/vodConfig';
import type { JsonObject } from '../../types';
import { CmsProvider, emptyResult } from '../cms';
import { getProvider, registerProvider, resetProviderRegistry, UnsupportedSiteError } from '../registry';
import type { SiteProvider } from '../types';

function site(json: JsonObject) {
  return parseSite({ key: 'k', name: 'n', api: 'https://a/api', ...json });
}

function stubProvider(s: SiteProvider['site'], destroy = jest.fn()): SiteProvider {
  const result = async () => emptyResult();
  return { site: s, home: result, homeVideo: result, category: result, detail: result, search: result, player: result, destroy };
}

afterEach(resetProviderRegistry);

describe('provider registry', () => {
  it('uses the CMS provider for types 0 and 1', () => {
    expect(getProvider(site({ key: 'xml', type: 0 }))).toBeInstanceOf(CmsProvider);
    expect(getProvider(site({ key: 'json', type: 1 }))).toBeInstanceOf(CmsProvider);
  });

  it('throws UnsupportedSiteError for JAR, unknown and unregistered JS sites', () => {
    expect(() => getProvider(site({ type: 3, api: 'csp_Douban' }))).toThrow(UnsupportedSiteError);
    expect(() => getProvider(site({ type: 4 }))).toThrow(UnsupportedSiteError);
    expect(() => getProvider(site({ type: 3, api: 'https://a/spider.js' }))).toThrow(UnsupportedSiteError);
  });

  it('returns a custom provider registered for type 3 .js sites', () => {
    const create = jest.fn((s: SiteProvider['site']) => stubProvider(s));
    registerProvider({ id: 'js', match: (s) => s.type === 3 && /\.js(?:[?#]|$)/i.test(s.api), create });

    const js = site({ key: 'js', type: 3, api: 'https://a/spider.js?v=1' });
    const provider = getProvider(js);
    expect(provider.site).toBe(js);
    expect(create).toHaveBeenCalledWith(js, {});
    expect(() => getProvider(site({ key: 'jar', type: 3, api: 'csp_Douban' }))).toThrow(UnsupportedSiteError);
  });

  it('caches per site key and recreates for a new site object', () => {
    const destroy = jest.fn();
    const create = jest.fn((s: SiteProvider['site']) => stubProvider(s, destroy));
    registerProvider({ id: 'custom', match: (s) => s.type === 1, create });

    const first = site({ key: 'a', type: 1 });
    expect(getProvider(first)).toBe(getProvider(first));
    expect(create).toHaveBeenCalledTimes(1);

    const reloaded = site({ key: 'a', type: 1 });
    expect(getProvider(reloaded).site).toBe(reloaded);
    expect(create).toHaveBeenCalledTimes(2);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('unregister and reset restore the built-in factories', () => {
    const remove = registerProvider({ id: 'custom', match: () => true, create: (s) => stubProvider(s) });
    expect(getProvider(site({ key: 'x', type: 4 }))).toBeDefined();
    remove();
    resetProviderRegistry();
    expect(() => getProvider(site({ key: 'x', type: 4 }))).toThrow(UnsupportedSiteError);
    expect(getProvider(site({ key: 'y', type: 1 }))).toBeInstanceOf(CmsProvider);
  });
});
