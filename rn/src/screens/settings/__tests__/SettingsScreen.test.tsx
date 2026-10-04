import AsyncStorage from '@react-native-async-storage/async-storage';
import { Modal, Platform, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type Bootstrap, BootstrapProvider, createBootstrap } from '../../../core/bootstrap';
import { parseVodConfig } from '../../../core/config';
import type { ServerLinkState } from '../../../core/serverLink';
import { appSettings } from '../../../core/settings';
import { configRepositories } from '../ConfigPanel';
import SettingsScreen from '..';

jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ navigate: jest.fn() }),
}));

jest.mock('../../../core/appConfig', () => ({
  getAppConfig: () => ({ workerUrl: '', versionName: '1.2.3', versionCode: 42 }),
}));

const mockLink = {
  state: 'OFF' as ServerLinkState,
  code: 'ABCD-EFGH',
  subscription: '',
  request: jest.fn(async () => undefined),
  refresh: jest.fn(async () => undefined),
  unlink: jest.fn(async () => undefined),
};
const mockLinkEnabled = jest.fn(() => false);
jest.mock('../../../core/serverLink', () => ({
  ...jest.requireActual('../../../core/serverLink'),
  isServerLinkEnabled: () => mockLinkEnabled(),
  useServerLink: () => mockLink,
}));

const URL_A = 'https://a.example.com/config.json';
const URL_B = 'https://b.example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [
    { key: 'jar', name: 'Jar 站', type: 3, api: 'csp_Jar' },
    { key: 'cms', name: 'CMS 站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' },
    { key: 'xml', name: 'XML 站', type: 0, api: 'https://xml.example.com/api.php/provide/vod/at/xml' },
  ],
});

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

function byID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findByProps({ testID });
}

function has(renderer: ReactTestRenderer, testID: string): boolean {
  return renderer.root.findAllByProps({ testID }).length > 0;
}

async function press(renderer: ReactTestRenderer, testID: string) {
  await act(async () => byID(renderer, testID).props.onPress());
}

async function setup(saved: string[] = []) {
  const configs = configRepositories.vod;
  for (const url of saved) await configs.add({ url, name: url === URL_A ? '配置 A' : '' });
  if (saved[0]) await configs.setActive(saved[0]);
  const loadConfig = jest.fn((url: string) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url)));
  const bootstrap: Bootstrap = createBootstrap({ configs, settings: appSettings, loadConfig: (url) => loadConfig(url) });
  await bootstrap.start();
  const reload = jest.spyOn(bootstrap, 'reload');
  const addConfig = jest.spyOn(bootstrap, 'addConfig');
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <SettingsScreen />
      </BootstrapProvider>,
    );
  });
  return { renderer, loadConfig, reload, addConfig };
}

describe('SettingsScreen', () => {
  const originalOS = Platform.OS;
  const originalIsTV = Platform.isTV;

  beforeEach(async () => {
    await AsyncStorage.clear();
    await appSettings.loadSettings();
    mockLinkEnabled.mockReturnValue(false);
    mockLink.state = 'OFF';
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'isTV', { value: originalIsTV, configurable: true });
    jest.restoreAllMocks();
  });

  it('focuses the first row and shows the active config and version', async () => {
    const { renderer } = await setup([URL_A]);
    expect(byID(renderer, 'settings-vod').props.hasTVPreferredFocus).toBe(true);
    const preferred = renderer.root.findAll((node) => node.props.hasTVPreferredFocus === true && typeof node.type !== 'string');
    expect(new Set(preferred.map((node) => node.props.testID))).toEqual(new Set(['settings-vod']));
    expect(texts(renderer)).toEqual(expect.arrayContaining(['点播配置', '配置 A', '1.2.3 (42)', 'CMS 站']));
    await act(async () => renderer.unmount());
  });

  it('selects a saved VOD config and reloads it', async () => {
    const { renderer, loadConfig, reload } = await setup([URL_A, URL_B]);
    const setActive = jest.spyOn(configRepositories.vod, 'setActive');
    await press(renderer, 'settings-vod');
    expect(byID(renderer, `settings-config-${URL_A}`).props.selected).toBe(true);
    expect(byID(renderer, `settings-config-${URL_A}`).props.hasTVPreferredFocus).toBe(true);
    expect(byID(renderer, 'settings-vod').props.hasTVPreferredFocus).toBe(false);

    await press(renderer, `settings-config-${URL_B}`);
    expect(setActive).toHaveBeenCalledWith(URL_B);
    expect(reload).toHaveBeenCalled();
    expect(loadConfig).toHaveBeenLastCalledWith(URL_B);
    expect(byID(renderer, `settings-config-${URL_B}`).props.selected).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('adds a VOD config and removes a saved one', async () => {
    const { renderer, addConfig } = await setup([URL_A]);
    await press(renderer, 'settings-vod');
    await act(async () => byID(renderer, 'settings-config-input').props.onChangeText(` ${URL_B} `));
    await press(renderer, 'settings-config-add');
    expect(addConfig).toHaveBeenCalledWith(URL_B);
    expect((await configRepositories.vod.getActive())?.url).toBe(URL_B);
    expect(byID(renderer, `settings-config-${URL_B}`).props.selected).toBe(true);

    await press(renderer, `settings-config-remove-${URL_A}`);
    expect(has(renderer, `settings-config-${URL_A}`)).toBe(false);
    expect(await configRepositories.vod.find(URL_A)).toBeUndefined();
    await act(async () => renderer.unmount());
  });

  it('adds and selects live configs', async () => {
    const { renderer, reload } = await setup();
    expect(texts(renderer)).toContain('直播配置');
    await press(renderer, 'settings-live');
    expect(byID(renderer, 'settings-config-input').props.hasTVPreferredFocus).toBe(true);
    for (const url of [URL_A, URL_B]) {
      await act(async () => byID(renderer, 'settings-config-input').props.onChangeText(url));
      await press(renderer, 'settings-config-add');
    }
    expect((await configRepositories.live.getActive())?.url).toBe(URL_B);
    await press(renderer, `settings-config-${URL_A}`);
    expect((await configRepositories.live.getActive())?.url).toBe(URL_A);
    expect(reload).not.toHaveBeenCalled();

    await press(renderer, 'settings-panel-close');
    expect(has(renderer, 'settings-panel')).toBe(false);
    expect(byID(renderer, 'settings-live').findAllByType(Text).map((node) => node.props.children)).toContain(URL_A);
    await act(async () => renderer.unmount());
  });

  it('closes an open panel on back before leaving the screen', async () => {
    const { renderer } = await setup();
    await press(renderer, 'settings-ua');
    expect(has(renderer, 'settings-panel')).toBe(true);
    await act(async () => renderer.root.findByType(Modal).props.onRequestClose());
    expect(has(renderer, 'settings-panel')).toBe(false);
    expect(byID(renderer, 'settings-vod').props.hasTVPreferredFocus).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('toggles booleans and cycles choices through the settings store', async () => {
    const { renderer } = await setup();
    await press(renderer, 'settings-incognito');
    expect(appSettings.get('incognito')).toBe(true);
    await press(renderer, 'settings-decode');
    expect(appSettings.get('decode')).toBe('soft');
    await press(renderer, 'settings-playerEngine');
    expect(appSettings.get('playerEngine')).toBe('mpv');
    expect(byID(renderer, 'settings-playerEngine').findAllByType(Text).map((node) => node.props.children)).toContain('MPV');
    await act(async () => renderer.unmount());
  });

  it('steps a decimal, picks a speed preset and saves text', async () => {
    const { renderer } = await setup();
    await press(renderer, 'settings-subtitleScale');
    await press(renderer, 'settings-step-up');
    expect(appSettings.get('subtitleScale')).toBe(1.1);
    expect(byID(renderer, 'settings-step-value').props.children).toBe('1.1x');
    await press(renderer, 'settings-panel-close');

    await press(renderer, 'settings-speedPlayback');
    expect(byID(renderer, 'settings-speed-1').props.hasTVPreferredFocus).toBe(true);
    await press(renderer, 'settings-speed-1.5');
    expect(appSettings.get('speedPlayback')).toBe(1.5);
    expect(has(renderer, 'settings-panel')).toBe(false);

    await press(renderer, 'settings-doh');
    await act(async () => byID(renderer, 'settings-text-input').props.onChangeText(' https://dns.example/dns-query '));
    await press(renderer, 'settings-text-save');
    expect(appSettings.get('doh')).toBe('https://dns.example/dns-query');
    await act(async () => renderer.unmount());
  });

  it('picks the home site and disables unsupported sites', async () => {
    const { renderer } = await setup([URL_A]);
    await press(renderer, 'settings-homeSite');
    expect(byID(renderer, 'settings-site-jar').props.disabled).toBe(true);
    expect(texts(renderer)).toContain('不支持：JAR 爬虫');
    expect(byID(renderer, 'settings-site-cms').props.hasTVPreferredFocus).toBe(true);
    await press(renderer, 'settings-site-xml');
    expect(appSettings.get('homeSiteKey')).toBe('xml');
    await act(async () => renderer.unmount());
  });

  it('shows AirPlay only on Android TV', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    Object.defineProperty(Platform, 'isTV', { value: true, configurable: true });
    let { renderer } = await setup();
    expect(has(renderer, 'settings-airplay')).toBe(false);
    await act(async () => renderer.unmount());

    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'isTV', { value: false, configurable: true });
    ({ renderer } = await setup());
    expect(has(renderer, 'settings-airplay')).toBe(false);
    await act(async () => renderer.unmount());

    Object.defineProperty(Platform, 'isTV', { value: true, configurable: true });
    ({ renderer } = await setup());
    await press(renderer, 'settings-airplay');
    expect(appSettings.get('airplay')).toBe(false);
    expect(has(renderer, 'settings-airplayName')).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('hides the server link section when the build has no worker', async () => {
    const { renderer } = await setup();
    expect(has(renderer, 'settings-serverLink')).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('requests, refreshes and unlinks the server link when enabled', async () => {
    mockLinkEnabled.mockReturnValue(true);
    const { renderer } = await setup();
    expect(byID(renderer, 'settings-serverLink').findAllByType(Text).map((node) => node.props.children)).toContain('未关联');
    await press(renderer, 'settings-serverLink');
    expect(texts(renderer)).toContain('设备码：ABCD-EFGH');
    expect(has(renderer, 'settings-link-unlink')).toBe(false);
    await press(renderer, 'settings-link-request');
    expect(mockLink.request).toHaveBeenCalled();
    await act(async () => renderer.unmount());

    mockLink.state = 'PENDING';
    const linked = await setup();
    await press(linked.renderer, 'settings-serverLink');
    expect(texts(linked.renderer)).toContain('状态：等待批准');
    expect(has(linked.renderer, 'settings-link-request')).toBe(false);
    await press(linked.renderer, 'settings-link-refresh');
    expect(mockLink.refresh).toHaveBeenCalled();
    await press(linked.renderer, 'settings-link-unlink');
    expect(mockLink.unlink).toHaveBeenCalled();
    await act(async () => linked.renderer.unmount());
  });
});
