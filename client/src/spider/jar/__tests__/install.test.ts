import { parseSite } from '../../../core/config/vodConfig';
import { findProviderFactory, resetProviderRegistry } from '../../../core/provider';
import { mockJarSpider } from '../__testutils__/mockNative';
import { getInstalledJarSpider, installJarSpiders, onJarConfigLoaded, resetJarSpidersForTest } from '../install';

const JAR = 'https://x/spider.jar';
const jarSite = () => parseSite({ key: 'a', type: 3, api: 'csp_A' }, JAR);

afterEach(() => {
  resetJarSpidersForTest();
  resetProviderRegistry();
});

describe('installJarSpiders', () => {
  it('is a no-op off Android or without the module', async () => {
    const native = mockJarSpider();
    installJarSpiders('ios', native);
    installJarSpiders('android', null);
    installJarSpiders();
    expect(getInstalledJarSpider()).toBeUndefined();
    expect(jarSite()).toMatchObject({ supported: false, unsupportedReason: 'jar' });
    expect(findProviderFactory(jarSite())).toBeUndefined();
    await onJarConfigLoaded({ spider: JAR });
    expect(native.clear).not.toHaveBeenCalled();
  });

  it('enables JAR sites and registers the provider on Android', () => {
    installJarSpiders('android', mockJarSpider());
    expect(jarSite()).toMatchObject({ supported: true });
    expect(findProviderFactory(jarSite())?.id).toBe('jar-spider');
  });
});

describe('onJarConfigLoaded', () => {
  it('clears the loader, then loads the config spider as recent without waiting', async () => {
    const native = mockJarSpider();
    native.loadJar.mockReturnValue(new Promise(() => undefined));
    installJarSpiders('android', native);
    await onJarConfigLoaded({ spider: JAR });
    expect(native.clear).toHaveBeenCalledTimes(1);
    expect(native.loadJar).toHaveBeenCalledWith(JAR, true);
    expect(native.clear.mock.invocationCallOrder[0]).toBeLessThan(native.loadJar.mock.invocationCallOrder[0]!);
  });

  it('only clears when the config has no spider, and swallows failures', async () => {
    const native = mockJarSpider();
    native.clear.mockRejectedValue(new Error('x'));
    installJarSpiders('android', native);
    await onJarConfigLoaded({ spider: '' });
    expect(native.clear).toHaveBeenCalled();
    expect(native.loadJar).not.toHaveBeenCalled();
  });
});
