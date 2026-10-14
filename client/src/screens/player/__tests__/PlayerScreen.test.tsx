import type { HWEvent } from 'react-native';
import { ActivityIndicator, BackHandler, FlatList, Modal, Pressable, ScrollView, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type Bootstrap, BootstrapProvider } from '../../../core/bootstrap';
import { parseVodConfig } from '../../../core/config/vodConfig';
import { registerProvider, resetProviderRegistry, type SiteProvider } from '../../../core/provider';
import { appSettings } from '../../../core/settings';
import { MemoryStore } from '../../../core/storage';
import { normalizeResult } from '../../../core/types';
import { setUserDataStore } from '../../../core/userData';
import type { RootStackScreenProps } from '../../../navigation/types';
import { getPlaybackController } from '../../../player/controller';
import { clearEngines, registerEngine } from '../../../player/engine/registry';
import type { EngineEvent } from '../../../player/engine/types';
import type { PlayerParams } from '../../../player/params';
import { createMockEngine, type MockEngine } from '../../../player/testing/mockEngine';
import PlayerScreen from '..';
import { SEEK_COMMIT_DELAY } from '../useRemoteKeys';

void [ActivityIndicator, FlatList, Modal, Pressable, ScrollView, TextInput];

let mockRemote: ((event: HWEvent) => void) | undefined;
jest.mock('react-native/Libraries/Components/TV/useTVEventHandler', () => ({
  __esModule: true,
  default: (handler: (event: HWEvent) => void) => {
    mockRemote = handler;
  },
}));

const config = parseVodConfig(JSON.stringify({ sites: [{ key: 'cms', name: 'CMS', type: 1, api: 'https://cms/api' }] }), 'https://cfg/');
const snapshot = { status: 'ready', config, entry: { id: 7, name: 'cfg', url: 'https://cfg/', time: 0 } } as const;
const bootstrap: Bootstrap = {
  start: async () => undefined,
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  reload: async () => undefined,
  addConfig: async () => undefined,
};

let video: MockEngine;
let mpv: MockEngine;
const goBack = jest.fn();
let navigationListeners: Record<string, () => void>;

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function render(params: PlayerParams): Promise<ReactTestRenderer> {
  const props = {
    route: { key: 'Player', name: 'Player', params },
    navigation: {
      isFocused: () => true,
      addListener: (event: string, listener: () => void) => {
        navigationListeners[event] = listener;
        return () => { delete navigationListeners[event]; };
      },
      setOptions: jest.fn(),
      goBack,
    },
  } as unknown as RootStackScreenProps<'Player'>;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <PlayerScreen {...props} />
      </BootstrapProvider>,
    );
  });
  await settle();
  return renderer;
}

async function emit(engine: MockEngine, event: EngineEvent) {
  await act(async () => engine.props!.onEvent(event));
  await settle();
}

async function remote(eventType: string, eventKeyAction = 1) {
  await act(async () => mockRemote!({ eventType, eventKeyAction }));
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

const load: EngineEvent = {
  type: 'load',
  duration: 600_000,
  tracks: { audio: [{ id: 'a1', label: '国语' }, { id: 'a2', label: '粤语' }], text: [{ id: 't1', label: '中文' }], video: [] },
};

beforeEach(async () => {
  navigationListeners = {};
  setUserDataStore(new MemoryStore());
  await act(async () => {
    await appSettings.set('playerEngine', 'auto');
    await appSettings.set('background', true);
  });
  video = createMockEngine('video');
  mpv = createMockEngine('mpv');
  registerEngine(video);
  registerEngine(mpv);
  goBack.mockClear();
});

afterEach(() => {
  clearEngines();
  resetProviderRegistry();
  setUserDataStore(undefined);
});

describe('PlayerScreen', () => {
  it.each([false, true])('pauses a covered screen and ignores its remote input (background: %s)', async (background) => {
    await act(async () => appSettings.set('background', background));
    const renderer = await render({ url: 'https://m/a.m3u8' });
    await emit(mpv, load);
    await act(async () => navigationListeners.blur!());
    expect(mpv.props?.paused).toBe(true);
    expect(getPlaybackController().getState().active).toBe(false);
    await remote('play');
    expect(mpv.props?.paused).toBe(true);
    await act(async () => navigationListeners.focus!());
    expect(getPlaybackController().getState()).toMatchObject({ active: true, playing: false });
    await remote('play');
    expect(mpv.props?.paused).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('cancels a pending seek and its preview when the screen loses focus', async () => {
    const renderer = await render({ url: 'https://m/a.m3u8' });
    await emit(mpv, load);
    jest.useFakeTimers();
    try {
      await remote('right', 0);
      expect(has(renderer, 'player-seek-target')).toBe(true);
      await act(async () => navigationListeners.blur!());
      await act(async () => jest.advanceTimersByTime(SEEK_COMMIT_DELAY));
      expect(mpv.seeks).toEqual([]);
      await act(async () => navigationListeners.focus!());
      expect(has(renderer, 'player-seek-target')).toBe(false);
      await remote('right', 0);
      await act(async () => jest.advanceTimersByTime(SEEK_COMMIT_DELAY));
      expect(mpv.seeks).toEqual([10_000]);
    } finally {
      jest.useRealTimers();
      await act(async () => renderer.unmount());
    }
  });

  it('plays a direct URL on the default engine and hosts the controller', async () => {
    const renderer = await render({ url: 'https://m/a.m3u8', title: '投屏', position: 5_000, headers: { Referer: 'https://r/' } });
    // jest-expo runs as iOS: mpv is the default.
    expect(mpv.props?.source).toMatchObject({ url: 'https://m/a.m3u8', title: '投屏', startPosition: 5_000 });
    expect(mpv.props?.source.headers).toMatchObject({ Referer: 'https://r/' });
    expect(mpv.props?.background).toBe(true);
    expect(texts(renderer)).toContain('正在加载…');

    await emit(mpv, load);
    expect(getPlaybackController().getState()).toMatchObject({ active: true, playing: true, title: '投屏' });
    await act(async () => renderer.unmount());
    expect(getPlaybackController().getState().active).toBe(false);
  });

  it('plays a VOD episode and switches episodes from the panel', async () => {
    registerProvider({
      id: 'test',
      match: (site) => site.key === 'cms',
      create: () =>
        ({
          detail: async () =>
            normalizeResult({
              list: [{ vod_id: '1', vod_name: '剧集', vod_play_from: 'a$$$b', vod_play_url: '第1集$https://m/1.m3u8#第2集$https://m/2.m3u8$$$第1集$https://n/1.m3u8' }],
            }),
          player: async (flag: string, id: string) => normalizeResult({ url: id, parse: 0, flag }),
        }) as unknown as SiteProvider,
    });
    const renderer = await render({ siteKey: 'cms', vodId: '1' });
    expect(mpv.props?.source).toMatchObject({ url: 'https://m/1.m3u8', title: '剧集 第1集' });

    await emit(mpv, load);
    await remote('down');
    expect(has(renderer, 'player-panel-episodes')).toBe(true);
    await press(renderer, 'player-flag-1');
    await press(renderer, 'player-episode-0');
    expect(has(renderer, 'player-panel-episodes')).toBe(false);
    expect(mpv.props?.source).toMatchObject({ url: 'https://n/1.m3u8' });
    await act(async () => renderer.unmount());
  });

  it('toggles pause with OK while the controls are hidden', async () => {
    const renderer = await render({ url: 'https://m/a.m3u8' });
    await emit(mpv, load);
    expect(mpv.props?.paused).toBe(false);
    await remote('select', 0);
    expect(mpv.props?.paused).toBe(false);
    await remote('select');
    expect(mpv.props?.paused).toBe(true);
    await remote('select');
    expect(mpv.props?.paused).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('seeks with left / right, growing the step while the key repeats', async () => {
    const renderer = await render({ url: 'https://m/a.m3u8', position: 60_000 });
    await emit(mpv, load);
    await emit(mpv, { type: 'progress', position: 60_000, duration: 600_000, buffered: 0 });
    await remote('right', 0);
    await remote('right', 0);
    await remote('right', 0);
    expect(byTestId(renderer, 'player-seek-target').props.children).toBe('01:30');
    await act(async () => new Promise((resolve) => setTimeout(resolve, SEEK_COMMIT_DELAY + 50)));
    expect(mpv.seeks).toEqual([90_000]);
    expect(has(renderer, 'player-seek-target')).toBe(false);

    await remote('left', 0);
    await act(async () => new Promise((resolve) => setTimeout(resolve, SEEK_COMMIT_DELAY + 50)));
    expect(mpv.seeks).toEqual([90_000, 80_000]);
    await act(async () => renderer.unmount());
  });

  it('falls back to the other engine on an init error and says so', async () => {
    const renderer = await render({ url: 'https://m/a.m3u8', position: 5_000 });
    await emit(mpv, { type: 'error', code: 1, message: 'no libmpv', fatal: true, phase: 'init', reason: 'init' });
    expect(video.props?.source).toMatchObject({ url: 'https://m/a.m3u8', startPosition: 5_000 });
    expect(byTestId(renderer, 'player-notice').props.children).toBe('已切换到 系统播放器 播放');
    expect(appSettings.get('playerEngine')).toBe('auto');
    await act(async () => renderer.unmount());
  });

  it('shows a Chinese error with retry when no engine can play', async () => {
    const renderer = await render({ url: 'https://m/a.m3u8' });
    await emit(mpv, { type: 'error', code: 404, message: 'HTTP 404', fatal: true, phase: 'init', reason: 'network' });
    expect(texts(renderer)).toContain('播放地址加载失败：HTTP 404');
    await press(renderer, 'player-error-retry');
    expect(has(renderer, 'player-error')).toBe(false);
    expect(mpv.props?.source).toMatchObject({ url: 'https://m/a.m3u8' });
    await act(async () => renderer.unmount());
  });

  it('opens the controls with up while the source is still loading', async () => {
    const renderer = await render({ url: 'https://m/a.m3u8', title: '标题' });
    expect(has(renderer, 'player-status')).toBe(true);
    expect(has(renderer, 'player-controls')).toBe(false);
    await remote('up');
    expect(has(renderer, 'player-controls')).toBe(true);
    expect(has(renderer, 'player-status')).toBe(true);
    await press(renderer, 'player-engine');
    expect(has(renderer, 'player-panel-settings')).toBe(true);
    await press(renderer, 'player-panel-close');
    await press(renderer, 'player-back');
    expect(goBack).toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('opens the controls and panels, and closes them with back', async () => {
    const handlers: (() => boolean | null | undefined)[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      handlers.push(handler as () => boolean);
      return { remove: () => undefined };
    });
    const renderer = await render({ url: 'https://m/a.m3u8', title: '标题' });
    await emit(mpv, load);
    expect(has(renderer, 'player-controls')).toBe(false);
    await remote('up');
    expect(has(renderer, 'player-controls')).toBe(true);
    expect(texts(renderer)).toContain('标题');

    await press(renderer, 'player-speed');
    expect(has(renderer, 'player-panel-speed')).toBe(true);
    await press(renderer, 'player-speed-1.5');
    expect(has(renderer, 'player-panel-speed')).toBe(false);
    expect(mpv.props?.rate).toBe(1.5);

    await press(renderer, 'player-audio');
    await press(renderer, 'player-audio-a2');
    expect(mpv.props?.selectedAudioTrack).toBe('a2');

    await press(renderer, 'player-subtitle');
    await press(renderer, 'player-subtitle-off');
    expect(mpv.props?.selectedTextTrack).toBeNull();

    await press(renderer, 'player-subtitle');
    await act(async () => byTestId(renderer, 'player-subtitle-url').props.onChangeText('https://s/zh.srt'));
    await press(renderer, 'player-subtitle-add');
    expect(mpv.props?.source.subtitles).toEqual([{ url: 'https://s/zh.srt', name: 'zh.srt' }]);

    await press(renderer, 'player-engine');
    expect(has(renderer, 'player-panel-settings')).toBe(true);
    await press(renderer, 'player-panel-close');
    expect(has(renderer, 'player-panel-settings')).toBe(false);

    // Back with a panel open closes only the panel, even when the activity gets the key instead of the modal.
    await press(renderer, 'player-engine');
    let closed: boolean | null | undefined;
    await act(async () => {
      closed = handlers[handlers.length - 1]!();
    });
    expect(closed).toBe(true);
    expect(has(renderer, 'player-panel-settings')).toBe(false);
    expect(has(renderer, 'player-controls')).toBe(true);

    // Panel closed, controls still shown: back hides them; with nothing shown it leaves the screen.
    expect(has(renderer, 'player-controls')).toBe(true);
    const back = handlers[handlers.length - 1]!;
    let handled: boolean | null | undefined;
    await act(async () => {
      handled = back();
    });
    expect(handled).toBe(true);
    expect(has(renderer, 'player-controls')).toBe(false);
    expect(handlers[handlers.length - 1]!()).toBe(false);
    spy.mockRestore();
    await act(async () => renderer.unmount());
  });

  it('switches the engine from the panel, persisting the choice and keeping the position', async () => {
    const renderer = await render({ url: 'https://m/a.m3u8' });
    await emit(mpv, load);
    await emit(mpv, { type: 'progress', position: 42_000, duration: 600_000, buffered: 0 });
    await remote('up');
    await press(renderer, 'player-engine');
    await press(renderer, 'player-settings-engine-video');
    expect(appSettings.get('playerEngine')).toBe('video');
    expect(video.props?.source).toMatchObject({ url: 'https://m/a.m3u8', startPosition: 42_000 });
    await act(async () => renderer.unmount());
  });

  it('sets the picture scale from the settings panel', async () => {
    await act(async () => appSettings.set('scale', 0));
    const renderer = await render({ url: 'https://m/a.m3u8' });
    await emit(mpv, load);
    await remote('up');
    await press(renderer, 'player-engine');
    await press(renderer, 'player-settings-scale-3');
    expect(appSettings.get('scale')).toBe(3);
    expect(mpv.props?.resizeMode).toBe('stretch');
    expect(has(renderer, 'player-panel-settings')).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('switches the line from the 画质 panel', async () => {
    registerProvider({
      id: 'test',
      match: (site) => site.key === 'cms',
      create: () =>
        ({
          detail: async () =>
            normalizeResult({
              list: [{ vod_id: '1', vod_name: '剧集', vod_play_from: 'a$$$b', vod_play_url: '第1集$https://m/1.m3u8$$$第1集$https://n/1.m3u8' }],
            }),
          player: async (flag: string, id: string) => normalizeResult({ url: id, parse: 0, flag }),
        }) as unknown as SiteProvider,
    });
    const renderer = await render({ siteKey: 'cms', vodId: '1' });
    await emit(mpv, load);
    await remote('up');
    expect(texts(renderer)).toContain('画质·a');
    await press(renderer, 'player-line');
    expect(has(renderer, 'player-panel-line')).toBe(true);
    await press(renderer, 'player-line-1');
    expect(mpv.props?.source).toMatchObject({ url: 'https://n/1.m3u8' });
    await act(async () => renderer.unmount());
  });

  it('passes the background setting to the engine', async () => {
    await act(async () => appSettings.set('background', false));
    const renderer = await render({ url: 'https://m/a.m3u8' });
    expect(mpv.props?.background).toBe(false);
    await act(async () => renderer.unmount());
  });
});
