import { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { type Bootstrap, BootstrapProvider } from '../../core/bootstrap';
import { parseVodConfig } from '../../core/config/vodConfig';
import type { SiteProvider } from '../../core/provider';
import { createSettingsStore, type SettingsStore } from '../../core/settings/settings';
import { historyKey, MemoryStore } from '../../core/storage';
import { normalizeResult } from '../../core/types';
import { getHistoryRepository, setUserDataStore } from '../../core/userData';
import { getPlaybackController } from '../controller';
import { clearEngines, registerEngine } from '../engine/registry';
import type { EngineEvent } from '../engine/types';
import type { PlayerParams } from '../params';
import { createMockEngine, type MockEngine } from '../testing/mockEngine';
import { usePlayback, type UsePlayback } from '../usePlayback';

const config = parseVodConfig(JSON.stringify({ sites: [{ key: 'cms', name: 'CMS', type: 1, api: 'https://cms/api' }] }), 'https://cfg/');
const snapshot = { status: 'ready', config, entry: { id: 7, name: 'cfg', url: 'https://cfg/', time: 0 } } as const;
const bootstrap: Bootstrap = {
  start: async () => undefined,
  getSnapshot: () => snapshot,
  subscribe: () => () => undefined,
  reload: async () => undefined,
  addConfig: async () => undefined,
};

const provider = {
  detail: jest.fn(async () =>
    normalizeResult({ list: [{ vod_id: '1', vod_name: 'Show', vod_play_from: 'line', vod_play_url: 'E1$https://m/1.m3u8#E2$https://m/2.m3u8' }] }),
  ),
  player: jest.fn(async (flag: string, id: string) => normalizeResult({ url: id, parse: 0, flag })),
} as unknown as SiteProvider;

let video: MockEngine;
let mpv: MockEngine;
let settings: SettingsStore;
const captured: { value?: UsePlayback } = {};

function Harness({ params }: { params: PlayerParams }) {
  const playback = usePlayback(params, { settings, getProvider: () => provider });
  const { engine, source, sourceKey, setEngineHandle, state, resizeMode, onEngineEvent } = playback;
  useEffect(() => {
    captured.value = playback;
  });
  const Engine = engine?.Component;
  if (!Engine || !source) return null;
  return (
    <Engine
      key={sourceKey}
      ref={setEngineHandle}
      source={source}
      paused={state.paused}
      rate={state.speed}
      resizeMode={resizeMode}
      onEvent={onEngineEvent}
    />
  );
}

async function render(params: PlayerParams): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <Harness params={params} />
      </BootstrapProvider>,
    );
  });
  await settle();
  return renderer;
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

async function emit(engine: MockEngine, event: EngineEvent) {
  await act(async () => engine.props!.onEvent(event));
  await settle();
}

const load: EngineEvent = { type: 'load', duration: 100_000, tracks: { audio: [], text: [], video: [] } };

beforeEach(() => {
  setUserDataStore(new MemoryStore());
  settings = createSettingsStore(new MemoryStore());
  video = createMockEngine('video');
  mpv = createMockEngine('mpv');
  registerEngine(video);
  registerEngine(mpv);
});

afterEach(clearEngines);

describe('usePlayback', () => {
  it('plays a VOD episode on the platform default engine, resuming the Detail history record', async () => {
    const key = historyKey('cms', '1');
    await getHistoryRepository().upsert({ key, cid: 7, vodFlag: 'line', vodRemarks: 'E2', episodeUrl: 'https://m/2.m3u8', position: 30_000, duration: 100_000 });
    const renderer = await render({ siteKey: 'cms', vodId: '1' });

    expect(captured.value!.state.engine).toBe('mpv'); // jest-expo runs as iOS
    expect(mpv.props?.source).toMatchObject({ url: 'https://m/2.m3u8', startPosition: 30_000, title: 'Show E2' });

    await emit(mpv, load);
    await emit(mpv, { type: 'progress', position: 40_000, duration: 100_000, buffered: 0 });
    expect(captured.value!.state.status).toBe('playing');
    await act(async () => captured.value!.pause());
    await settle();
    expect(await getHistoryRepository().get(7, key)).toMatchObject({ position: 40_000 });

    await act(async () => captured.value!.prev());
    await settle();
    expect(mpv.props?.source).toMatchObject({ url: 'https://m/1.m3u8', startPosition: undefined });
    expect(await getHistoryRepository().get(7, key)).toMatchObject({ vodRemarks: 'E1', episodeUrl: 'https://m/1.m3u8' });
    await act(async () => renderer.unmount());
  });

  it('falls back to the other engine once, keeping the setting', async () => {
    const renderer = await render({ url: 'https://m/live.m3u8', title: 'Cast', position: 5_000 });
    await emit(mpv, { type: 'error', code: 1, message: 'cannot open', fatal: true, phase: 'playback', reason: 'open' });
    expect(captured.value!.state.engine).toBe('video');
    expect(video.props?.source).toMatchObject({ url: 'https://m/live.m3u8', startPosition: 5_000 });
    expect(settings.get('playerEngine')).toBe('auto');

    await emit(video, { type: 'error', code: 2, message: 'x', fatal: true, phase: 'init', reason: 'init' });
    expect(captured.value!.state.status).toBe('error');
    await act(async () => renderer.unmount());
  });

  it('falls back to the same episode on the next line keeping the history position', async () => {
    const detail = provider.detail as jest.Mock;
    const player = provider.player as jest.Mock;
    detail.mockImplementationOnce(async () =>
      normalizeResult({
        list: [{ vod_id: '1', vod_name: 'Show', vod_play_from: 'bad$$$good', vod_play_url: 'E1$https://bad/1#E2$https://bad/2$$$E2$https://m/2.m3u8' }],
      }),
    );
    player.mockImplementationOnce(async () => {
      throw new Error('404');
    });
    const key = historyKey('cms', '1');
    await getHistoryRepository().upsert({ key, cid: 7, vodFlag: 'bad', vodRemarks: 'E2', episodeUrl: 'https://bad/2', position: 30_000, duration: 100_000 });
    const renderer = await render({ siteKey: 'cms', vodId: '1' });

    expect(captured.value!.state).toMatchObject({ flagIndex: 1, episodeIndex: 0, notice: '正在切换线路至「good」' });
    expect(mpv.props?.source).toMatchObject({ url: 'https://m/2.m3u8', startPosition: 30_000 });
    expect(await getHistoryRepository().get(7, key)).toMatchObject({ vodFlag: 'good', vodRemarks: 'E2' });
    await act(async () => renderer.unmount());
  });

  it('serves the app-wide controller while mounted', async () => {
    const controller = getPlaybackController();
    const renderer = await render({ url: 'https://m/a.m3u8', title: 'A' });
    await emit(mpv, load);
    expect(controller.getState()).toMatchObject({ active: true, playing: true, title: 'A', url: 'https://m/a.m3u8', engine: 'mpv' });

    await act(async () => controller.pause());
    expect(controller.getState()).toMatchObject({ playing: false, status: 'paused' });
    await act(async () => controller.seekTo(12_000));
    expect(mpv.seeks).toEqual([12_000]);
    await act(async () => controller.repeat());
    expect(controller.getState().repeat).toBe(true);

    await act(async () => controller.playUrl('https://m/b.m3u8', { title: 'B' }));
    await settle();
    expect(mpv.props?.source).toMatchObject({ url: 'https://m/b.m3u8', title: 'B' });

    await act(async () => renderer.unmount());
    expect(controller.getState().active).toBe(false);
  });
});
