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
  it('does not warm a config invalidated while native cleanup was pending', async () => {
    const native = mockJarSpider();
    let finish!: () => void;
    let current = true;
    native.clear.mockReturnValue(new Promise<void>((resolve) => { finish = resolve; }));
    installJarSpiders('android', native);
    const pending = onJarConfigLoaded({ spider: JAR }, () => current);
    current = false;
    finish();
    await pending;
    expect(native.loadJar).not.toHaveBeenCalled();
  });

  it('does not make a stale background download the recent JAR', async () => {
    const native = mockJarSpider();
    let finish!: (value: boolean) => void;
    const download = new Promise<boolean>((resolve) => { finish = resolve; });
    let current = true;
    let recent = '';
    native.setRecent.mockImplementation((jar: string) => { recent = jar; });
    native.loadJar.mockImplementation(async (jar: string, makeRecent: boolean) => {
      if (jar === JAR) await download;
      if (makeRecent) recent = jar;
      return true;
    });
    installJarSpiders('android', native);
    await onJarConfigLoaded({ spider: JAR }, () => current);
    current = false;
    const nextJar = 'https://x/next.jar';
    await onJarConfigLoaded({ spider: nextJar });
    finish(true);
    await download;
    await Promise.resolve();
    expect(recent).toBe(nextJar);
  });

  it('clears the loader, then loads the config spider as recent without waiting', async () => {
    const native = mockJarSpider();
    native.loadJar.mockReturnValue(new Promise(() => undefined));
    installJarSpiders('android', native);
    await onJarConfigLoaded({ spider: JAR });
    expect(native.clear).toHaveBeenCalledTimes(1);
    expect(native.loadJar).toHaveBeenCalledWith(JAR, false);
    expect(native.setRecent).not.toHaveBeenCalled();
    expect(native.clear.mock.invocationCallOrder[0]).toBeLessThan(native.loadJar.mock.invocationCallOrder[0]!);
  });

  it('makes the current config JAR recent after it loads', async () => {
    const native = mockJarSpider();
    installJarSpiders('android', native);
    await onJarConfigLoaded({ spider: JAR });
    expect(native.setRecent).toHaveBeenCalledWith(JAR);
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
