import { createRef, useReducer } from 'react';
import { Dimensions, NativeModules } from 'react-native';
import { act, create } from 'react-test-renderer';

import { appSettings } from '../../../../core/settings';
import { makeScaler, scaleFor } from '../../../../ui';
import { clearEngines, getEngine } from '../../../engine/registry';
import type { EngineEvent, EngineHandle, EngineSource, EngineViewProps } from '../../../engine/types';
import { initialPlaybackState, playbackReducer } from '../../../machine';
import { registerBuiltinEngines } from '../../index';
import { subtitleMime, toSubtitleStyle, toVideoSize, toVideoSource } from '../mapping';
import { isVideoEngineAvailable, VideoEngineView, videoEngineFactory } from '../VideoEngine';

// Records the props of the last <Video> render and the seeks made through its ref.
const mockVideo: { props: Record<string, any>; seeks: number[] } = { props: {}, seeks: [] };

jest.mock('react-native-video', () => {
  const { useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  function Video({ ref, ...props }: { ref?: React.Ref<unknown> } & Record<string, unknown>) {
    mockVideo.props = props;
    useImperativeHandle(ref, () => ({ seek: (s: number) => mockVideo.seeks.push(s) }), []);
    return null;
  }
  return {
    __esModule: true,
    default: Video,
    SelectedTrackType: { SYSTEM: 'system', DISABLED: 'disabled', TITLE: 'title', LANGUAGE: 'language', INDEX: 'index' },
    TextTrackType: { SUBRIP: 'application/x-subrip', TTML: 'application/ttml+xml', VTT: 'text/vtt' },
  };
});

const source: EngineSource = {
  url: 'https://cdn/a.m3u8',
  headers: { Referer: 'https://site/' },
  title: 'Show',
  startPosition: 30_000,
  format: 'application/x-mpegURL',
  subtitles: [
    { url: 'https://cdn/zh.srt', name: '中文', lang: 'zh' },
    { url: 'https://cdn/en.vtt?token=1', name: 'English', lang: 'en' },
    { url: 'https://cdn/fx.ass', name: '特效' },
    { url: 'https://cdn/sub', name: 'Hinted', format: 'text/vtt' },
  ],
};

function render(overrides: Partial<EngineViewProps> = {}) {
  const events: EngineEvent[] = [];
  const ref = createRef<EngineHandle>();
  const props: EngineViewProps = {
    source,
    paused: false,
    rate: 1.5,
    resizeMode: 'fill',
    onEvent: (event) => events.push(event),
    ...overrides,
  };
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(<VideoEngineView ref={ref} {...props} />);
  });
  return { events, ref, renderer, props };
}

beforeEach(() => {
  mockVideo.props = {};
  mockVideo.seeks = [];
});

describe('video engine props', () => {
  it('maps the source, playback state, resize mode and background', () => {
    render({ background: true });
    expect(mockVideo.props).toMatchObject({
      source: {
        uri: 'https://cdn/a.m3u8',
        headers: { Referer: 'https://site/' },
        startPosition: 30_000,
        type: 'm3u8',
        metadata: { title: 'Show' },
        textTracks: [
          { title: '中文', language: 'zh', type: 'application/x-subrip', uri: 'https://cdn/zh.srt' },
          { title: 'English', language: 'en', type: 'text/vtt', uri: 'https://cdn/en.vtt?token=1' },
          { title: 'Hinted', language: '', type: 'text/vtt', uri: 'https://cdn/sub' },
        ],
      },
      paused: false,
      rate: 1.5,
      resizeMode: 'stretch',
      playInBackground: true,
      playWhenInactive: true,
    });
    expect(mockVideo.props.selectedAudioTrack).toBeUndefined();
    expect(mockVideo.props.selectedTextTrack).toBeUndefined();
  });

  it('defaults to no background playback and maps track selection', () => {
    render({ selectedAudioTrack: 1, selectedTextTrack: null, resizeMode: 'cover' });
    expect(mockVideo.props).toMatchObject({
      playInBackground: false,
      playWhenInactive: false,
      resizeMode: 'cover',
      selectedAudioTrack: { type: 'index', value: 1 },
      selectedTextTrack: { type: 'disabled' },
    });
  });

  it('leaves optional source fields out', () => {
    expect(toVideoSource({ url: 'https://cdn/a.mp4', headers: {}, subtitles: [] })).toEqual({ uri: 'https://cdn/a.mp4', headers: {} });
    expect(toVideoSource({ url: 'u', headers: {}, subtitles: [], format: 'application/dash+xml' })).toMatchObject({ type: 'mpd' });
  });

  it('types subtitles by MIME hint, then extension', () => {
    expect(subtitleMime({ url: 'https://x/a.SRT', name: '' })).toBe('application/x-subrip');
    expect(subtitleMime({ url: 'https://x/a.ttml', name: '' })).toBe('application/ttml+xml');
    expect(subtitleMime({ url: 'https://x/a.ass', name: '' })).toBeUndefined();
    expect(subtitleMime({ url: 'https://x/a.srt', name: '', format: 'text/x-ssa' })).toBe('application/x-subrip');
  });
});

describe('video engine subtitle style', () => {
  afterEach(() => act(() => appSettings.set('subtitleScale', 1)));

  it('sizes the design subtitle box at 1080p and applies subtitleScale', () => {
    const identity = (px: number) => px;
    expect(toSubtitleStyle(identity, 1)).toEqual({ fontSize: 36, opacity: 1 });
    expect(toSubtitleStyle(identity, 1.5)).toEqual({ fontSize: 54, opacity: 1 });
    // Never below the 20px design minimum.
    expect(toSubtitleStyle(identity, 0.5)).toEqual({ fontSize: 20, opacity: 1 });
  });

  it('passes the scaled subtitle style to Video and follows the setting', async () => {
    const s = makeScaler(scaleFor(Dimensions.get('window').width));
    render();
    expect(mockVideo.props.subtitleStyle).toEqual(toSubtitleStyle(s, 1));
    await act(() => appSettings.set('subtitleScale', 2));
    expect(mockVideo.props.subtitleStyle).toEqual(toSubtitleStyle(s, 2));
    expect(mockVideo.props.subtitleStyle.fontSize).toBeGreaterThan(toSubtitleStyle(s, 1).fontSize!);
  });
});

describe('video engine events', () => {
  it.each([false, true])('keeps playback intent while waiting for media (seeking: %s)', (isSeeking) => {
    function Harness() {
      const [state, dispatch] = useReducer(playbackReducer, playbackReducer(initialPlaybackState, {
        type: 'open', source, engine: 'video', speed: 1,
      }));
      return <VideoEngineView source={source} paused={state.paused} rate={1} resizeMode="contain"
        onEvent={(event) => dispatch({ type: 'engine', event })} />;
    }
    let renderer!: ReturnType<typeof create>;
    act(() => { renderer = create(<Harness />); });
    act(() => mockVideo.props.onLoad({ duration: 100, audioTracks: [], textTracks: [], videoTracks: [] }));
    act(() => {
      mockVideo.props.onBuffer({ isBuffering: true });
      mockVideo.props.onPlaybackStateChanged({ isPlaying: false, isSeeking });
    });
    expect(mockVideo.props.paused).toBe(false);
    act(() => mockVideo.props.onBuffer({ isBuffering: false }));
    expect(mockVideo.props.paused).toBe(false);
    act(() => renderer.unmount());
  });

  it('does not undo a user pause when a late playing callback arrives', () => {
    const { events, renderer } = render({ paused: true });
    act(() => mockVideo.props.onPlaybackStateChanged({ isPlaying: true, isSeeking: false }));
    expect(events).not.toContainEqual({ type: 'playing' });
    act(() => mockVideo.props.onPlaybackStateChanged({ isPlaying: false, isSeeking: false }));
    expect(events).toContainEqual({ type: 'paused' });
    act(() => renderer.unmount());
  });

  it('maps load, progress, buffering, state and end', () => {
    const { events } = render();
    act(() => {
      mockVideo.props.onLoad({
        currentTime: 0,
        duration: 120.5,
        naturalSize: { width: 1920, height: 1080, orientation: 'landscape' },
        audioTracks: [
          { index: 0, title: '国语', language: 'zh', selected: true },
          { index: 1, language: 'en' },
          { index: 2 },
        ],
        textTracks: [{ index: 0, title: '中文', type: 'text/vtt' }],
        videoTracks: [{ index: 0, width: 1920, height: 1080, selected: true }, { index: 1 }],
      });
      mockVideo.props.onProgress({ currentTime: 10.25, playableDuration: 30, seekableDuration: 120 });
      mockVideo.props.onBuffer({ isBuffering: true });
      mockVideo.props.onPlaybackStateChanged({ isPlaying: true, isSeeking: false });
      mockVideo.props.onPlaybackStateChanged({ isPlaying: false, isSeeking: false });
      mockVideo.props.onEnd();
    });
    expect(events).toEqual([
      {
        type: 'load',
        duration: 120_500,
        tracks: {
          audio: [
            { id: 0, label: '国语', language: 'zh', selected: true },
            { id: 1, label: 'en', language: 'en' },
            { id: 2, label: '音轨 3' },
          ],
          text: [{ id: 0, label: '中文' }],
          video: [
            { id: 0, label: '1920x1080', selected: true },
            { id: 1, label: '视频 2' },
          ],
        },
        width: 1920,
        height: 1080,
      },
      { type: 'progress', position: 10_250, duration: 120_500, buffered: 30_000 },
      { type: 'buffering', value: true },
      { type: 'playing' },
      { type: 'ended' },
    ]);
  });

  it('maps naturalSize to an upright video size', () => {
    expect(toVideoSize({ width: 1280, height: 720, orientation: 'landscape' })).toEqual({ width: 1280, height: 720 });
    expect(toVideoSize({ width: 1920, height: 1080, orientation: 'portrait' })).toEqual({ width: 1080, height: 1920 });
    expect(toVideoSize({ width: 1080, height: 1920, orientation: 'portrait' })).toEqual({ width: 1080, height: 1920 });
    expect(toVideoSize({ width: 0, height: 0, orientation: 'landscape' })).toBeUndefined();
    expect(toVideoSize(undefined)).toBeUndefined();
  });

  it('reports track list updates', () => {
    const { events } = render();
    act(() => mockVideo.props.onTextTracks({ textTracks: [{ index: 0, title: 'English', selected: true }] }));
    expect(events).toEqual([{ type: 'tracks', audio: [], text: [{ id: 0, label: 'English', selected: true }], video: [] }]);
  });

  it('reports errors as init before the first load, playback after', () => {
    const { events } = render();
    const error = { error: { errorString: 'ExoPlaybackException: ERROR_CODE_IO_BAD_HTTP_STATUS', errorCode: '22004' } };
    act(() => mockVideo.props.onError(error));
    act(() => mockVideo.props.onLoad({ duration: 1, audioTracks: [], textTracks: [], videoTracks: [] }));
    act(() => mockVideo.props.onError(error));
    expect(events.filter((e) => e.type === 'error')).toEqual([
      { type: 'error', code: '22004', message: error.error.errorString, fatal: true, phase: 'init', reason: 'network' },
      { type: 'error', code: '22004', message: error.error.errorString, fatal: true, phase: 'playback', reason: 'network' },
    ]);
  });

  it('seeks in seconds through the handle', () => {
    const { ref } = render();
    ref.current?.seek(90_500);
    expect(mockVideo.seeks).toEqual([90.5]);
  });
});

describe('video engine factory', () => {
  afterEach(() => {
    clearEngines();
    delete NativeModules.VideoManager;
  });

  it('is unavailable without the native module and does not throw', () => {
    expect(isVideoEngineAvailable()).toBe(false);
  });

  it('is available when the native module is linked', () => {
    NativeModules.VideoManager = {};
    expect(isVideoEngineAvailable()).toBe(true);
  });

  it('registers as the video engine', () => {
    registerBuiltinEngines();
    expect(getEngine('video')).toBe(videoEngineFactory);
    expect(videoEngineFactory).toMatchObject({ kind: 'video', label: '系统播放器' });
  });
});
