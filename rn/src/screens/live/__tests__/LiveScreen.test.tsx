import type { HWEvent } from 'react-native';
import { ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type Bootstrap, BootstrapProvider } from '../../../core/bootstrap';
import { parseVodConfig } from '../../../core/config/vodConfig';
import { appSettings } from '../../../core/settings';
import { MemoryStore } from '../../../core/storage';
import { type Group, normalizeLive } from '../../../core/types';
import { setUserDataStore } from '../../../core/userData';
import type { RootStackParamList, RootStackScreenProps } from '../../../navigation/types';
import { getPlaybackController } from '../../../player/controller';
import { clearEngines, registerEngine } from '../../../player/engine/registry';
import type { EngineEvent } from '../../../player/engine/types';
import { dateInZone, getLiveController } from '../../../player/live';
import { emptyChannel } from '../../../player/live/channel';
import { fetchChannelEpg } from '../../../player/live/epg';
import { loadLiveGroups, loadLiveSources, readLiveState, saveLiveHome, saveLiveKeep } from '../../../player/live/source';
import { createMockEngine, type MockEngine } from '../../../player/testing/mockEngine';
import LiveScreen, { PASS_PRESSES } from '..';

void [ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput];

let mockRemote: ((event: HWEvent) => void) | undefined;
jest.mock('react-native/Libraries/Components/TV/useTVEventHandler', () => ({
  __esModule: true,
  default: (handler: (event: HWEvent) => void) => {
    mockRemote = handler;
  },
}));
jest.mock('../../../player/live/source', () => ({
  loadLiveSources: jest.fn(),
  loadLiveGroups: jest.fn(),
  readLiveState: jest.fn(),
  saveLiveHome: jest.fn(async () => undefined),
  saveLiveKeep: jest.fn(async () => undefined),
}));
jest.mock('../../../player/live/epg', () => ({
  ...jest.requireActual('../../../player/live/epg'),
  fetchChannelEpg: jest.fn(),
}));

const config = parseVodConfig(JSON.stringify({ sites: [] }), 'https://cfg/');
const snapshot = { status: 'ready', config } as const;
const bootstrap: Bootstrap = {
  start: async () => undefined,
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  reload: async () => undefined,
  addConfig: async () => undefined,
};

const channel = (name: string, number: string, urls: string[], extra: Partial<ReturnType<typeof emptyChannel>> = {}) => ({
  ...emptyChannel(name),
  number,
  urls,
  ...extra,
});
const live = normalizeLive({ name: '直播A', url: 'http://a/list.txt' });
const other = normalizeLive({ name: '直播B', url: 'http://b/list.txt' });
const groups = (): Group[] => [
  { name: '收藏', pass: '', channel: [] },
  {
    name: '央视',
    pass: '',
    channel: [
      channel('CCTV1', '001', ['http://m/1a$高清', 'http://m/1b'], { ua: 'UA1', referer: 'http://r/', epg: 'http://epg/{date}' }),
      channel('CCTV2', '002', ['http://m/2']),
    ],
  },
  { name: '卫视', pass: '', channel: [channel('浙江卫视', '010', ['http://m/zj'])] },
];
const vip = (): Group => ({ name: 'VIP', pass: '8888', channel: [channel('V1', '100', ['http://m/v1'])] });

let video: MockEngine;
let mpv: MockEngine;

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function render(params?: RootStackParamList['Live']): Promise<ReactTestRenderer> {
  const props = {
    route: { key: 'Live', name: 'Live', params },
    navigation: { isFocused: () => true, addListener: () => () => undefined, setOptions: jest.fn(), goBack: jest.fn() },
  } as unknown as RootStackScreenProps<'Live'>;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <LiveScreen {...props} />
      </BootstrapProvider>,
    );
  });
  await settle();
  return renderer;
}

async function remote(eventType: string) {
  await act(async () => mockRemote!({ eventType, eventKeyAction: 1 }));
  await settle();
}

async function emit(engine: MockEngine, event: EngineEvent) {
  await act(async () => engine.props!.onEvent(event));
  await settle();
}

function byTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll((node) => node.props.testID === testID)[0]!;
}

const has = (renderer: ReactTestRenderer, testID: string) => renderer.root.findAll((node) => node.props.testID === testID).length > 0;
const texts = (renderer: ReactTestRenderer) => renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));

async function press(renderer: ReactTestRenderer, testID: string) {
  await act(async () => byTestId(renderer, testID).props.onPress());
  await settle();
}

const fatal = (reason: 'open' | 'network'): EngineEvent => ({ type: 'error', code: 1, message: 'boom', fatal: true, phase: 'playback', reason });
const playing = () => mpv.props?.source.url;

beforeEach(async () => {
  setUserDataStore(new MemoryStore());
  await act(async () => {
    await appSettings.set('playerEngine', 'auto');
    await appSettings.set('background', true);
    await appSettings.set('across', true);
    await appSettings.set('invert', false);
    await appSettings.set('change', true);
  });
  video = createMockEngine('video');
  mpv = createMockEngine('mpv');
  registerEngine(video);
  registerEngine(mpv);
  jest.mocked(loadLiveSources).mockResolvedValue({ lives: [live, other], home: live });
  jest.mocked(loadLiveGroups).mockImplementation(async (home) => ({ live: home, visible: groups(), hidden: [vip()] }));
  jest.mocked(readLiveState).mockResolvedValue({ home: '', keep: {} });
  jest.mocked(saveLiveKeep).mockClear();
  jest.mocked(saveLiveHome).mockClear();
  const now = Date.now();
  const today = dateInZone(now, '');
  jest.mocked(fetchChannelEpg).mockResolvedValue({
    list: [
      {
        key: 'CCTV1',
        date: today,
        list: [
          { title: '新闻联播', start: '19:00', end: '19:30', startTime: now - 60_000, endTime: now + 60_000 },
          { title: '焦点访谈', start: '19:30', end: '19:45', startTime: now + 60_000, endTime: now + 120_000 },
        ],
      },
    ],
    today: { key: 'CCTV1', date: today, list: [] },
  });
});

afterEach(() => {
  clearEngines();
  setUserDataStore(undefined);
});

describe('LiveScreen', () => {
  it('plays the first channel after 收藏 with its headers, info bar and EPG', async () => {
    const renderer = await render();
    expect(playing()).toBe('http://m/1a');
    expect(mpv.props?.source.headers).toMatchObject({ 'User-Agent': 'UA1', Referer: 'http://r/' });
    expect(fetchChannelEpg).toHaveBeenCalledWith(expect.objectContaining({ name: 'CCTV1' }), '');
    expect(saveLiveKeep).toHaveBeenLastCalledWith('直播A', '央视@@@CCTV1@@@http://m/1a');
    const shown = texts(renderer);
    expect(shown).toContain('CCTV1');
    expect(shown).toContain('线路 1/2');
    expect(shown).toContain('当前：19:00 ~ 19:30  新闻联播');
    expect(shown).toContain('下一个：19:30 ~ 19:45  焦点访谈');

    await emit(mpv, { type: 'load', duration: 0, tracks: { audio: [], text: [], video: [] } });
    expect(getPlaybackController().getState()).toMatchObject({ active: true, title: 'CCTV1', url: 'http://m/1a' });
    await act(async () => renderer.unmount());
    expect(getPlaybackController().getState().active).toBe(false);
  });

  it('starts on the saved channel and on the route position', async () => {
    jest.mocked(readLiveState).mockResolvedValue({ home: '直播A', keep: { 直播A: '央视@@@CCTV2@@@http://m/2' } });
    let renderer = await render();
    expect(playing()).toBe('http://m/2');
    await act(async () => renderer.unmount());

    renderer = await render({ groupIndex: 2, channelIndex: 0 });
    expect(playing()).toBe('http://m/zj');
    await act(async () => renderer.unmount());
  });

  it('changes channel with up / down, across groups and inverted', async () => {
    const renderer = await render();
    await remote('down');
    expect(playing()).toBe('http://m/2');
    await remote('channelDown');
    expect(playing()).toBe('http://m/zj');
    await remote('up');
    expect(playing()).toBe('http://m/2');

    await act(async () => appSettings.set('invert', true));
    await remote('up');
    expect(playing()).toBe('http://m/zj');

    await act(async () => appSettings.set('across', false));
    await remote('up');
    // 卫视 has one channel: wraps within the group.
    expect(playing()).toBe('http://m/zj');
    await act(async () => renderer.unmount());
  });

  it('switches source with left / right', async () => {
    const renderer = await render();
    await remote('right');
    expect(playing()).toBe('http://m/1b');
    expect(texts(renderer)).toContain('线路 2/2');
    await remote('right');
    expect(playing()).toBe('http://m/1a');
    await remote('left');
    expect(playing()).toBe('http://m/1b');
    await act(async () => renderer.unmount());
  });

  it('tries the next source on a fatal error, then the engine fallback', async () => {
    const renderer = await render();
    await emit(mpv, fatal('open'));
    expect(playing()).toBe('http://m/1b');
    expect(texts(renderer)).toContain('播放失败，切换到线路 2');

    await emit(mpv, fatal('open'));
    expect(video.props?.source.url).toBe('http://m/1b');
    expect(texts(renderer)).toContain('已切换到 系统播放器 播放');

    await emit(video, fatal('network'));
    expect(has(renderer, 'live-error')).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('does not change source on error when `change` is off', async () => {
    await act(async () => appSettings.set('change', false));
    const renderer = await render();
    await emit(mpv, fatal('network'));
    expect(has(renderer, 'live-error')).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('opens the channel list on OK and plays the pressed channel', async () => {
    const renderer = await render();
    await remote('select');
    expect(has(renderer, 'live-list')).toBe(true);
    // Keys belong to the list while it is open.
    await remote('down');
    expect(playing()).toBe('http://m/1a');

    await press(renderer, 'live-group-2');
    await press(renderer, 'live-channel-0');
    expect(has(renderer, 'live-list')).toBe(false);
    expect(playing()).toBe('http://m/zj');
    await act(async () => renderer.unmount());
  });

  it('switches the live source from the menu panel', async () => {
    const renderer = await render();
    await remote('info');
    expect(has(renderer, 'live-panel')).toBe(true);
    await press(renderer, 'live-source-1');
    expect(saveLiveHome).toHaveBeenCalledWith('直播B');
    expect(loadLiveGroups).toHaveBeenLastCalledWith(other, expect.anything());
    expect(has(renderer, 'live-panel')).toBe(false);
    expect(playing()).toBe('http://m/1a');
    await act(async () => renderer.unmount());
  });

  it('unlocks password groups after repeated presses on 收藏', async () => {
    const renderer = await render();
    await remote('select');
    for (let i = 0; i < PASS_PRESSES; i++) await press(renderer, 'live-group-0');
    expect(has(renderer, 'live-pass')).toBe(true);
    await act(async () => byTestId(renderer, 'live-pass-input').props.onChangeText('8888'));
    await press(renderer, 'live-pass-ok');
    expect(has(renderer, 'live-list')).toBe(true);
    expect(texts(renderer)).toContain('VIP');
    await act(async () => renderer.unmount());
  });

  it('is the playback host and the live select target while focused', async () => {
    const renderer = await render();
    await act(async () => getPlaybackController().next());
    await settle();
    expect(playing()).toBe('http://m/2');
    await act(async () => getPlaybackController().prev());
    await settle();
    expect(playing()).toBe('http://m/1a');

    expect((await getLiveController().listGroups()).map((group) => group.name)).toEqual(['收藏', '央视', '卫视']);
    await act(async () => getLiveController().selectChannel(2, 0));
    await settle();
    expect(playing()).toBe('http://m/zj');
    await act(async () => renderer.unmount());
  });

  it('shows an empty message without live sources', async () => {
    jest.mocked(loadLiveSources).mockResolvedValue({ lives: [] });
    const renderer = await render();
    expect(has(renderer, 'live-empty')).toBe(true);
    expect(texts(renderer)).toContain('暂无直播源');
    await act(async () => renderer.unmount());
  });
});
