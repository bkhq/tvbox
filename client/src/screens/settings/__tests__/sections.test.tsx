import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ComponentType } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type Bootstrap, BootstrapProvider, createBootstrap } from '../../../core/bootstrap';
import { parseVodConfig } from '../../../core/config';
import { appSettings } from '../../../core/settings';
import type { CheckResult, Release, UpdateState } from '../../../update';
import { configRepositories } from '../ConfigPanel';
import {
  AboutSection,
  LiveSection,
  NetworkSection,
  PlaybackSection,
  sectionHint,
  settingsSections,
  SourcesSection,
  SubtitleAudioSection,
} from '../sections';

void [Modal, Pressable, ScrollView, TextInput];

jest.mock('../../../core/appConfig', () => ({
  getAppConfig: () => ({ workerUrl: '', versionName: '1.2.3', versionCode: 42 }),
}));

const mockLinkEnabled = jest.fn(() => false);
jest.mock('../../../core/serverLink', () => ({
  ...jest.requireActual('../../../core/serverLink'),
  isServerLinkEnabled: () => mockLinkEnabled(),
  useServerLink: () => ({ state: 'OFF', code: 'ABCD', request: jest.fn(), refresh: jest.fn(), unlink: jest.fn() }),
}));

const mockCache = { size: 0, clear: jest.fn(async () => undefined) };
jest.mock('../cache', () => ({
  ...jest.requireActual('../cache'),
  getCacheSize: async () => mockCache.size,
  clearCache: () => mockCache.clear(),
}));

const mockUpdate = {
  state: { checking: false, lastResult: null, release: null, installState: { phase: 'idle' } } as UpdateState,
  listeners: new Set<() => void>(),
};
function setUpdate(next: Pick<UpdateState, 'checking' | 'lastResult'>) {
  mockUpdate.state = { ...mockUpdate.state, ...next };
  mockUpdate.listeners.forEach((listener) => listener());
}

const mockController = {
  getState: () => mockUpdate.state,
  subscribe: (listener: () => void) => {
    mockUpdate.listeners.add(listener);
    return () => void mockUpdate.listeners.delete(listener);
  },
  check: jest.fn(async () => {
    const result: CheckResult = { status: 'up-to-date' };
    mockUpdate.state = { ...mockUpdate.state, lastResult: result };
    mockUpdate.listeners.forEach((listener) => listener());
    return result;
  }),
  install: jest.fn(async () => undefined),
  dismiss: jest.fn(),
};
jest.mock('../../../update', () => ({
  ...jest.requireActual('../../../update'),
  getUpdateController: () => mockController,
}));

const URL_A = 'https://a.example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [
    { key: 'cms', name: 'CMS 站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' },
    { key: 'xml', name: 'XML 站', type: 0, api: 'https://xml.example.com/api.php/provide/vod/at/xml' },
  ],
});

const SECTIONS: [string, ComponentType<{ hasTVPreferredFocus?: boolean }>][] = [
  ['play', PlaybackSection],
  ['subaudio', SubtitleAudioSection],
  ['live', LiveSection],
  ['net', NetworkSection],
  ['sources', SourcesSection],
  ['about', AboutSection],
];

/** Every row of the previous settings list. */
const ROW_KEYS = [
  'vod',
  'live',
  'homeSite',
  'serverLink',
  'playerEngine',
  'decode',
  'render',
  'scale',
  'buffer',
  'background',
  'speedPlayback',
  'speedLongPress',
  'speedSkipSilence',
  'audioPassThrough',
  'audioPrefer',
  'videoPrefer',
  'preferAac',
  'tunnel',
  'subtitleStyleSource',
  'subtitleScale',
  'subtitlePosition',
  'doh',
  'ua',
  'incognito',
  'adblock',
  'siteMode',
  'airplay',
  'airplayName',
  'version',
];

function texts(renderer: ReactTestRenderer, testID?: string): string[] {
  const root = testID ? byID(renderer, testID) : renderer.root;
  return root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
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

async function render(Section: ComponentType<{ hasTVPreferredFocus?: boolean }>, saved: string[] = []) {
  const configs = configRepositories.vod;
  for (const url of saved) await configs.add({ url, name: '配置 A' });
  if (saved[0]) await configs.setActive(saved[0]);
  const bootstrap: Bootstrap = createBootstrap({
    configs,
    settings: appSettings,
    loadConfig: (url) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url)),
  });
  await bootstrap.start();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <Section hasTVPreferredFocus />
      </BootstrapProvider>,
    );
  });
  return renderer;
}

describe('settings sections', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const originalOS = Platform.OS;
  const originalIsTV = Platform.isTV;

  beforeEach(async () => {
    await AsyncStorage.clear();
    await appSettings.loadSettings();
    mockLinkEnabled.mockReturnValue(false);
    mockCache.size = 0;
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'isTV', { value: originalIsTV, configurable: true });
  });

  it('describes the sidebar entries', () => {
    expect(settingsSections.map((section) => section.id)).toEqual([
      'collect',
      'history',
      'play',
      'subaudio',
      'live',
      'net',
      'sources',
      'about',
    ]);
    expect(settingsSections.map((section) => section.label)).toEqual([
      '我的片单',
      '观看历史',
      '播放设置',
      '字幕与音频',
      '直播设置',
      '网络与缓存',
      '配置与源',
      '关于',
    ]);
  });

  it('builds the sidebar hints', () => {
    const values = { playerEngine: 'mpv' as const, subtitleScale: 1.2, cacheSize: 2048, versionName: '1.2.3' };
    expect(sectionHint('play', values)).toBe('MPV');
    expect(sectionHint('play', { ...values, playerEngine: 'auto' })).toBe('自动');
    expect(sectionHint('subaudio', values)).toBe('1.2x');
    expect(sectionHint('net', values)).toBe('2 KB');
    expect(sectionHint('net', { ...values, cacheSize: undefined })).toBe('');
    expect(sectionHint('about', values)).toBe('v1.2.3');
    expect(sectionHint('live', values)).toBe('');
  });

  it('places every previous setting row in exactly one section', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'isTV', { value: true, configurable: true });
    mockLinkEnabled.mockReturnValue(true);
    const owners = new Map<string, string[]>();
    for (const [id, Section] of SECTIONS) {
      const renderer = await render(Section);
      expect(texts(renderer)).toContain(settingsSections.find((section) => section.id === id)!.title);
      for (const key of ROW_KEYS) {
        if (has(renderer, `settings-${key}`)) owners.set(key, [...(owners.get(key) ?? []), id]);
      }
      await act(async () => renderer.unmount());
    }
    for (const key of ROW_KEYS) expect([key, owners.get(key)?.length]).toEqual([key, 1]);
  });

  it('toggles, switches segments and picks from a panel in the playback section', async () => {
    const renderer = await render(PlaybackSection);
    expect(byID(renderer, 'settings-playerEngine').props.hasTVPreferredFocus).toBe(true);
    expect(byID(renderer, 'settings-incognito-toggle')).toBeDefined();
    await press(renderer, 'settings-incognito');
    expect(appSettings.get('incognito')).toBe(true);

    expect(byID(renderer, 'settings-decode-hard').props.selected).toBe(true);
    await press(renderer, 'settings-decode-soft');
    expect(appSettings.get('decode')).toBe('soft');
    expect(byID(renderer, 'settings-decode-soft').props.selected).toBe(true);

    expect(texts(renderer, 'settings-playerEngine')).toContain('自动');
    await press(renderer, 'settings-playerEngine');
    expect(has(renderer, 'settings-panel')).toBe(true);
    expect(byID(renderer, 'settings-playerEngine').props.hasTVPreferredFocus).toBe(false);
    expect(byID(renderer, 'settings-playerEngine-auto').props.hasTVPreferredFocus).toBe(true);
    await press(renderer, 'settings-playerEngine-mpv');
    expect(appSettings.get('playerEngine')).toBe('mpv');
    expect(has(renderer, 'settings-panel')).toBe(false);
    expect(texts(renderer, 'settings-playerEngine')).toContain('MPV');

    await press(renderer, 'settings-speedPlayback');
    await press(renderer, 'settings-speed-1.5');
    expect(appSettings.get('speedPlayback')).toBe(1.5);
    await act(async () => renderer.unmount());
  });

  it('steps the subtitle scale', async () => {
    const renderer = await render(SubtitleAudioSection);
    expect(byID(renderer, 'settings-subtitleStyleSource-original').props.hasTVPreferredFocus).toBe(true);
    await press(renderer, 'settings-subtitleScale');
    await press(renderer, 'settings-step-up');
    expect(appSettings.get('subtitleScale')).toBe(1.1);
    await press(renderer, 'settings-panel-close');
    expect(texts(renderer, 'settings-subtitleScale')).toContain('1.1x');
    await act(async () => renderer.unmount());
  });

  it('edits the live switches and live scale', async () => {
    const renderer = await render(LiveSection);
    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['直播配置', '跨分类换台', '失败自动换源', '换台反转', '缩放比例']),
    );
    await press(renderer, 'settings-across');
    expect(appSettings.get('across')).toBe(false);
    await press(renderer, 'settings-scaleLive');
    await press(renderer, 'settings-scaleLive-3');
    expect(appSettings.get('scaleLive')).toBe(3);
    expect(texts(renderer, 'settings-scaleLive')).toContain('填充');
    await act(async () => renderer.unmount());
  });

  it('saves text settings and clears the cache', async () => {
    mockCache.size = 1024;
    const renderer = await render(NetworkSection);
    expect(has(renderer, 'settings-airplay')).toBe(false);
    expect(byID(renderer, 'settings-doh').props.hasTVPreferredFocus).toBe(true);
    await press(renderer, 'settings-doh');
    await act(async () => byID(renderer, 'settings-text-input').props.onChangeText(' https://dns.example/dns-query '));
    await press(renderer, 'settings-text-save');
    expect(appSettings.get('doh')).toBe('https://dns.example/dns-query');

    expect(texts(renderer, 'settings-cache')).toEqual(expect.arrayContaining(['已占用 1 KB', '清理缓存']));
    mockCache.size = 0;
    await press(renderer, 'settings-cache-clear');
    expect(mockCache.clear).toHaveBeenCalled();
    expect(texts(renderer, 'settings-cache')).toEqual(expect.arrayContaining(['已占用 0 B', '已清理']));
    await act(async () => renderer.unmount());
  });

  it('shows the config sources and the server link only when enabled', async () => {
    let renderer = await render(SourcesSection, [URL_A]);
    expect(byID(renderer, 'settings-vod').props.hasTVPreferredFocus).toBe(true);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['点播配置', '配置 A', 'CMS 站']));
    expect(has(renderer, 'settings-serverLink')).toBe(false);
    await press(renderer, 'settings-siteMode-1');
    expect(appSettings.get('siteMode')).toBe(1);
    await press(renderer, 'settings-homeSite');
    await press(renderer, 'settings-site-xml');
    expect(appSettings.get('homeSiteKey')).toBe('xml');
    await act(async () => renderer.unmount());

    mockLinkEnabled.mockReturnValue(true);
    renderer = await render(SourcesSection);
    await press(renderer, 'settings-serverLink');
    expect(has(renderer, 'settings-link-request')).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('checks for updates from the about section', async () => {
    setUpdate({ checking: false, lastResult: null });
    const renderer = await render(AboutSection);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['1.2.3 (42)', '检查更新']));
    expect(byID(renderer, 'update-check').props.hasTVPreferredFocus).toBe(true);
    expect(has(renderer, 'update-result')).toBe(false);
    await press(renderer, 'update-check');
    expect(mockController.check).toHaveBeenCalledWith(true);
    expect(texts(renderer, 'update-result')).toEqual(['已是最新版本']);
    await act(async () => renderer.unmount());
  });

  it('shows the checking state and each check result', async () => {
    setUpdate({ checking: false, lastResult: null });
    const renderer = await render(AboutSection);
    // A running check hides the previous result and disables the button.
    await act(async () => setUpdate({ checking: true, lastResult: { status: 'up-to-date' } }));
    expect(texts(renderer, 'update-check')).toEqual(['正在检查…']);
    expect(byID(renderer, 'update-check').props.disabled).toBe(true);
    expect(has(renderer, 'update-result')).toBe(false);

    const release = { versionName: '2.0.0' } as Release;
    const results: [CheckResult, string][] = [
      [{ status: 'available', release }, '发现新版本 v2.0.0'],
      [{ status: 'up-to-date' }, '已是最新版本'],
      [{ status: 'error', error: new Error('offline') }, '检查更新失败，请稍后重试'],
    ];
    for (const [lastResult, text] of results) {
      await act(async () => setUpdate({ checking: false, lastResult }));
      expect(texts(renderer, 'update-check')).toEqual(['检查更新']);
      expect(byID(renderer, 'update-check').props.disabled).toBe(false);
      expect(texts(renderer, 'update-result')).toEqual([text]);
    }
    await act(async () => renderer.unmount());
  });
});
