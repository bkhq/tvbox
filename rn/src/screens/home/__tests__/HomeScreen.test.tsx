import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type Bootstrap, BootstrapProvider, createBootstrap } from '../../../core/bootstrap';
import { parseVodConfig, type VodConfig, type VodConfigPrefs } from '../../../core/config';
import type { ServerLink } from '../../../core/serverLink';
import { createSettingsStore } from '../../../core/settings';
import { createConfigRepository, MemoryStore } from '../../../core/storage';
import HomeScreen from '..';

const mockNavigate = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ navigate: mockNavigate }),
}));

const URL = 'https://example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [
    { key: 'jar', name: 'Jar 站', type: 3, api: 'csp_Jar' },
    { key: 'cms', name: 'CMS 站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' },
    { key: 'xml', name: 'XML 站', type: 0, api: 'https://xml.example.com/api.php/provide/vod/at/xml' },
    { key: 'py', name: 'Py 站', type: 3, api: 'https://example.com/spider.py' },
  ],
});

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

async function setup(options: { saved?: boolean; load?: (url: string, prefs?: VodConfigPrefs) => Promise<VodConfig>; link?: Partial<ServerLink> }) {
  const store = new MemoryStore();
  const configs = createConfigRepository(store, 'vod');
  const settings = createSettingsStore(store);
  if (options.saved) {
    await configs.add({ url: URL, name: '我的配置' });
    await configs.setActive(URL);
  }
  const loadConfig = jest.fn(options.load ?? ((url: string, _prefs?: VodConfigPrefs) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url))));
  const link = options.link && ({ init: jest.fn(async () => undefined), onConfigError: jest.fn(), ...options.link } as ServerLink);
  const bootstrap = createBootstrap({
    configs,
    settings,
    loadConfig: (url, prefs) => loadConfig(url, prefs),
    createServerLink: link ? () => link : undefined,
  });
  await bootstrap.start();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <HomeScreen />
      </BootstrapProvider>,
    );
  });
  return { renderer, bootstrap: bootstrap as Bootstrap, configs, loadConfig, link };
}

describe('HomeScreen', () => {
  beforeEach(() => mockNavigate.mockClear());

  it('lists the sites of the active config and marks unsupported ones', async () => {
    const { renderer, loadConfig } = await setup({ saved: true });
    expect(loadConfig).toHaveBeenCalledWith(URL, { home: undefined });
    const shown = texts(renderer);
    expect(shown).toEqual(
      expect.arrayContaining(['我的配置', 'Jar 站', 'CMS 站', 'XML 站', 'Py 站', '不支持：JAR 爬虫', '不支持：Python 爬虫']),
    );

    const cms = renderer.root.findByProps({ testID: 'home-site-cms' });
    expect(cms.props.hasTVPreferredFocus).toBe(true);
    expect(cms.findAllByType(Text).map((node) => node.props.children)).toContain('首页');
    expect(renderer.root.findByProps({ testID: 'home-site-jar' }).props.disabled).toBe(true);

    await act(async () => renderer.root.findByProps({ testID: 'home-site-xml' }).props.onPress());
    const xml = renderer.root.findByProps({ testID: 'home-site-xml' });
    expect(xml.findAllByType(Text).map((node) => node.props.children)).toContain('首页');

    await act(async () => renderer.root.findByProps({ testID: 'home-nav-Settings' }).props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
    await act(async () => renderer.unmount());
  });

  it('adds a config when none is saved', async () => {
    const { renderer, configs, loadConfig } = await setup({});
    expect(texts(renderer)).toEqual(expect.arrayContaining(['尚未添加配置', '添加配置']));
    expect(loadConfig).not.toHaveBeenCalled();
    expect(renderer.root.findByProps({ testID: 'home-config-input' }).props.hasTVPreferredFocus).toBe(true);

    await act(async () => renderer.root.findByProps({ testID: 'home-config-input' }).props.onChangeText(` ${URL} `));
    await act(async () => renderer.root.findByProps({ testID: 'home-config-add' }).props.onPress());

    expect((await configs.getActive())?.url).toBe(URL);
    expect(loadConfig).toHaveBeenCalledWith(URL, { home: undefined });
    expect(texts(renderer)).toContain('CMS 站');
    await act(async () => renderer.unmount());
  });

  it('shows the load error, reports it to the server link and retries', async () => {
    const failure = new Error('HTTP 404: ' + URL);
    let fail = true;
    const { renderer, loadConfig, link } = await setup({
      saved: true,
      load: (url) => (fail ? Promise.reject(failure) : Promise.resolve(parseVodConfig(CONFIG_TEXT, url))),
      link: {},
    });
    expect(link?.init).toHaveBeenCalled();
    expect(link?.onConfigError).toHaveBeenCalledWith(URL, failure);
    expect(texts(renderer)).toContain(`配置加载失败：${failure.message}`);
    expect(renderer.root.findByProps({ testID: 'home-reload' }).props.hasTVPreferredFocus).toBe(true);

    fail = false;
    await act(async () => renderer.root.findByProps({ testID: 'home-reload' }).props.onPress());
    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(texts(renderer)).toContain('CMS 站');
    await act(async () => renderer.unmount());
  });

  it('shows a config the server link loads', async () => {
    let linkLoad: ((url: string) => Promise<unknown>) | undefined;
    const store = new MemoryStore();
    const configs = createConfigRepository(store, 'vod');
    const bootstrap = createBootstrap({
      configs,
      settings: createSettingsStore(store),
      loadConfig: (url) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url)),
      createServerLink: (load) => {
        linkLoad = load;
        return { init: async () => undefined, onConfigError: jest.fn() } as unknown as ServerLink;
      },
    });
    await bootstrap.start();
    expect(bootstrap.getSnapshot().status).toBe('empty');

    // What the link does when a subscription is approved.
    await configs.add({ url: URL });
    await configs.setActive(URL);
    await linkLoad?.(URL);
    expect(bootstrap.getSnapshot()).toMatchObject({ status: 'ready', entry: { url: URL } });
  });
});
