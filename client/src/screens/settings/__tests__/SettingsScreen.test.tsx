import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TVFocusGuideView,
} from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type Bootstrap, BootstrapProvider, createBootstrap } from '../../../core/bootstrap';
import { parseVodConfig } from '../../../core/config';
import { appSettings } from '../../../core/settings';
import { historyKey, MemoryStore } from '../../../core/storage';
import { getHistoryRepository, getKeepRepository, setUserDataStore } from '../../../core/userData';
import { Tab } from '../../../ui';
import type { UpdateState } from '../../../update';
import { formatBytes } from '../cache';
import { configRepositories } from '../ConfigPanel';
import { settingsSections } from '../sections';
import SettingsScreen from '..';

// react-native resolves components lazily on first access; resolve the ones the
// screen renders while the file loads so no test pays that cost inside its timeout.
void [ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput, TVFocusGuideView];

// On TV the panel's focus guide sends its destinations through a native command, which the preset's
// view mock lacks; the destinations are recorded as the (mock) component instances.
const mockSetDestinations = jest.fn();
jest.mock('react-native/Libraries/Components/View/ViewNativeComponent', () => ({
  __esModule: true,
  ...jest.requireActual('@react-native/jest-preset/jest/mocks/ViewNativeComponent'),
  Commands: { setDestinations: (...args: unknown[]) => mockSetDestinations(...args) },
}));
jest.mock('react-native/Libraries/Components/TV/tagForComponentOrHandle', () => ({
  __esModule: true,
  default: (component: unknown) => component,
}));

const mockNavigate = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), addListener: () => () => undefined }),
}));

jest.mock('../../../core/appConfig', () => ({
  getAppConfig: () => ({ workerUrl: '', versionName: '1.2.3', versionCode: 42 }),
}));

const mockLinkEnabled = jest.fn(() => false);
jest.mock('../../../core/serverLink', () => ({
  ...jest.requireActual('../../../core/serverLink'),
  isServerLinkEnabled: () => mockLinkEnabled(),
  useServerLink: () => ({ state: 'OFF', code: 'ABCD', request: jest.fn(), refresh: jest.fn(), unlink: jest.fn() }),
}));

const CACHE_SIZE = 5 * 1024 * 1024;
jest.mock('../cache', () => ({
  ...jest.requireActual('../cache'),
  getCacheSize: async () => CACHE_SIZE,
  clearCache: async () => undefined,
}));

const mockUpdateState: UpdateState = { checking: false, lastResult: null, release: null, installState: { phase: 'idle' } };
jest.mock('../../../update', () => ({
  ...jest.requireActual('../../../update'),
  getUpdateController: () => ({
    getState: () => mockUpdateState,
    subscribe: () => () => undefined,
    check: jest.fn(async () => ({ status: 'up-to-date' })),
    install: jest.fn(async () => undefined),
    dismiss: jest.fn(),
  }),
}));

const URL_A = 'https://a.example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [{ key: 'cms', name: 'CMS 站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' }],
});

/** A row of each section, proving the panel shows that section. */
const SECTION_ROWS: [string, string][] = [
  ['collect', 'collect-grid'],
  ['history', 'history-grid'],
  ['play', 'settings-playerEngine'],
  ['subaudio', 'settings-subtitleScale'],
  ['live', 'settings-live'],
  ['net', 'settings-doh'],
  ['sources', 'settings-vod'],
  ['about', 'settings-version'],
];

/** Every row of the previous settings list (server link and AirPlay only when available). */
const ROW_IDS = [
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
].map((key) => `settings-${key}`);

function byID(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findByProps({ testID });
}

function has(renderer: ReactTestRenderer, testID: string): boolean {
  return renderer.root.findAllByProps({ testID }).length > 0;
}

function textOf(renderer: ReactTestRenderer, testID: string): string {
  return [byID(renderer, testID).props.children].flat().join('');
}

async function press(renderer: ReactTestRenderer, testID: string) {
  await act(async () => byID(renderer, testID).props.onPress());
}

async function focus(renderer: ReactTestRenderer, testID: string) {
  await act(async () => byID(renderer, testID).props.onFocus());
}

/** testID of the element focus lands on when entering the panel from the menu (Platform.isTV). */
function panelEntry(): string | undefined {
  const [, destinations] = mockSetDestinations.mock.calls.at(-1) ?? [];
  // A component instance of the View mock; a FocusEntry wrapper holds the control as its child.
  const node = destinations?.[0];
  return node?.props.testID ?? node?.props.children?.props.testID;
}

async function setup() {
  setUserDataStore(new MemoryStore());
  const configs = configRepositories.vod;
  await configs.add({ url: URL_A, name: '配置 A' });
  await configs.setActive(URL_A);
  const bootstrap: Bootstrap = createBootstrap({
    configs,
    settings: appSettings,
    loadConfig: (url) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url)),
  });
  await bootstrap.start();
  const cid = bootstrap.getSnapshot().entry!.id;
  await getKeepRepository().add({ key: historyKey('cms', 'a'), cid, siteName: 'CMS 站', vodName: '甲', vodPic: '' });
  for (const id of ['a', 'b']) {
    await getHistoryRepository().upsert({ key: historyKey('cms', id), cid, vodName: id, vodPic: '', vodRemarks: '' });
    jest.advanceTimersByTime(5);
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <SettingsScreen />
      </BootstrapProvider>,
    );
  });
  return renderer;
}

describe('SettingsScreen', () => {
  // VirtualizedList batches cell updates on a 50 ms timer; fake timers keep it from
  // firing outside act() on a slow host, and unmounting clears it.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const originalOS = Platform.OS;
  const originalIsTV = Platform.isTV;

  beforeEach(async () => {
    await AsyncStorage.clear();
    await appSettings.loadSettings();
    mockLinkEnabled.mockReturnValue(false);
    jest.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
    Object.defineProperty(Platform, 'isTV', { value: originalIsTV, configurable: true });
  });

  it('shows the top bar with 我的 active and searches from it', async () => {
    const renderer = await setup();
    const tabs = renderer.root.findAllByType(Tab).map((tab) => [tab.props.label, tab.props.active]);
    expect(tabs).toContainEqual(['我的', true]);
    expect(tabs.filter(([, active]) => active)).toHaveLength(1);
    expect(has(renderer, 'settings-top-nav')).toBe(true);

    await press(renderer, 'top-nav-search');
    expect(mockNavigate).toHaveBeenCalledWith('Search');
    await press(renderer, 'top-nav-home');
    expect(mockNavigate).toHaveBeenCalledWith('Home', {});
    await act(async () => renderer.unmount());
  });

  it('lists the eight sections with their hints and focuses the selected one', async () => {
    const renderer = await setup();
    const labels = settingsSections.map(
      ({ id }) => byID(renderer, `settings-menu-${id}`).findAllByType(Text)[0]!.props.children,
    );
    expect(labels).toEqual([
      '我的片单',
      '观看历史',
      '播放设置',
      '字幕与音频',
      '直播设置',
      '网络与缓存',
      '配置与源',
      '关于',
    ]);
    expect(textOf(renderer, 'settings-menu-collect-hint')).toBe('1');
    expect(textOf(renderer, 'settings-menu-history-hint')).toBe('2');
    expect(textOf(renderer, 'settings-menu-play-hint')).toBe('自动');
    expect(textOf(renderer, 'settings-menu-subaudio-hint')).toBe('1.0x');
    expect(textOf(renderer, 'settings-menu-net-hint')).toBe(formatBytes(CACHE_SIZE));
    expect(textOf(renderer, 'settings-menu-about-hint')).toBe('v1.2.3');
    expect(has(renderer, 'settings-menu-live-hint')).toBe(false);

    // 播放设置 is selected by default and is the only preferred focus.
    expect(byID(renderer, 'settings-menu-play').props.accessibilityState.selected).toBe(true);
    expect(has(renderer, 'settings-playerEngine')).toBe(true);
    const preferred = renderer.root.findAll(
      (node) => node.props.hasTVPreferredFocus === true && typeof node.type !== 'string' && node.props.testID,
    );
    expect(new Set(preferred.map((node) => node.props.testID))).toEqual(new Set(['settings-menu-play']));
    await act(async () => renderer.unmount());
  });

  it('switches the panel when a menu item is focused or pressed', async () => {
    const renderer = await setup();
    for (const [id, row] of SECTION_ROWS) {
      await focus(renderer, `settings-menu-${id}`);
      expect(byID(renderer, `settings-menu-${id}`).props.accessibilityState.selected).toBe(true);
      expect(has(renderer, row)).toBe(true);
    }
    for (const [id, row] of [...SECTION_ROWS].reverse()) {
      await press(renderer, `settings-menu-${id}`);
      expect(has(renderer, row)).toBe(true);
      const others = SECTION_ROWS.filter(([other]) => other !== id).map(([, otherRow]) => otherRow);
      expect(others.filter((other) => has(renderer, other))).toEqual([]);
    }
    await act(async () => renderer.unmount());
  });

  it('keeps every previous setting reachable through some section', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(Platform, 'isTV', { value: true, configurable: true });
    mockLinkEnabled.mockReturnValue(true);
    const renderer = await setup();
    const reached = new Set<string>();
    for (const { id } of settingsSections) {
      await press(renderer, `settings-menu-${id}`);
      for (const testID of [...ROW_IDS, 'update-check']) if (has(renderer, testID)) reached.add(testID);
    }
    expect([...reached].sort()).toEqual([...ROW_IDS, 'update-check'].sort());
    await act(async () => renderer.unmount());
  });

  it('enters every section on its first element', async () => {
    Object.defineProperty(Platform, 'isTV', { value: true, configurable: true });
    const renderer = await setup();
    // Play is shown first.
    expect(panelEntry()).toBe('settings-playerEngine');
    const firstCard = (channel: string) =>
      renderer.root.findAll(
        (node) => typeof node.type === 'string' && node.props.testID?.startsWith(`${channel}-card-`),
      )[0]!.props.testID;
    const entries: [string, () => string][] = [
      ['collect', () => firstCard('collect')],
      ['history', () => firstCard('history')],
      ['play', () => 'settings-playerEngine'],
      // The selected segment of 样式来源, not the row below it.
      ['subaudio', () => `settings-subtitleStyleSource-${appSettings.get('subtitleStyleSource')}`],
      ['live', () => 'settings-live'],
      ['net', () => 'settings-doh'],
      ['sources', () => 'settings-vod'],
      // The row view; its only focusable is 检查更新.
      ['about', () => 'settings-version'],
    ];
    for (const [id, entry] of entries) {
      await press(renderer, `settings-menu-${id}`);
      expect([id, panelEntry()]).toEqual([id, entry()]);
    }

    // An empty list lands on 删除.
    await press(renderer, 'settings-menu-history');
    await press(renderer, 'history-clear');
    await press(renderer, 'history-confirm-ok');
    expect(panelEntry()).toBe('history-edit');
    await act(async () => renderer.unmount());
  });

  it('manages history and the watchlist inline', async () => {
    const renderer = await setup();
    await press(renderer, 'settings-menu-history');
    expect(has(renderer, 'history-edit')).toBe(true);
    await press(renderer, 'history-clear');
    await press(renderer, 'history-confirm-ok');
    expect(textOf(renderer, 'settings-menu-history-hint')).toBe('0');

    await press(renderer, 'settings-menu-collect');
    await press(renderer, 'collect-edit');
    await press(renderer, `collect-card-${historyKey('cms', 'a')}`);
    expect(textOf(renderer, 'settings-menu-collect-hint')).toBe('0');
    await act(async () => renderer.unmount());
  });
});
