import type { EngineViewProps } from '../../../engine/types';
import {
  classifyMpvError,
  createMpvEventMapper,
  MPV_END_FILE_EOF,
  MPV_END_FILE_ERROR,
  MpvError,
  toNativeProps,
  toTracks,
  trackSelection,
} from '../mapping';

const baseProps: EngineViewProps = {
  source: {
    url: 'https://cdn/a.m3u8',
    headers: { 'User-Agent': 'UA', Referer: 'https://ref/' },
    title: 'Show',
    startPosition: 30_500,
    format: 'application/x-mpegURL',
    subtitles: [{ url: 'https://cdn/a.srt', name: '中文', lang: 'zh', format: 'application/x-subrip' }],
  },
  paused: true,
  rate: 1.5,
  resizeMode: 'cover',
  onEvent: () => undefined,
};

describe('toNativeProps', () => {
  it('maps engine props to native mpv props (seconds, track selections, decode)', () => {
    expect(toNativeProps({ ...baseProps, selectedAudioTrack: 2, selectedTextTrack: null }, 'soft')).toEqual({
      source: {
        url: 'https://cdn/a.m3u8',
        headers: { 'User-Agent': 'UA', Referer: 'https://ref/' },
        title: 'Show',
        startPosition: 30.5,
        format: 'application/x-mpegURL',
        subtitles: [{ url: 'https://cdn/a.srt', name: '中文', lang: 'zh' }],
      },
      paused: true,
      speed: 1.5,
      audioTrack: '2',
      subtitleTrack: 'no',
      resizeMode: 'cover',
      decode: 'soft',
    });
  });

  it('starts at 0 and leaves track choice to mpv by default', () => {
    const props = toNativeProps({ ...baseProps, source: { ...baseProps.source, startPosition: undefined } }, 'hard');
    expect(props.source.startPosition).toBe(0);
    expect(props.audioTrack).toBe('auto');
    expect(props.subtitleTrack).toBe('auto');
  });

  it('trackSelection: undefined -> auto, null -> no, id -> string', () => {
    expect(trackSelection(undefined)).toBe('auto');
    expect(trackSelection(null)).toBe('no');
    expect(trackSelection('3')).toBe('3');
  });
});

describe('toTracks', () => {
  it('groups mpv tracks by type with Chinese fallback labels', () => {
    expect(
      toTracks([
        { id: 1, type: 'video', codec: 'h264', selected: true, external: false },
        { id: 1, type: 'audio', lang: 'jpn', selected: true, external: false },
        { id: 2, type: 'audio', title: 'Commentary', lang: 'eng', selected: false, external: false },
        { id: 1, type: 'sub', title: null, lang: null, selected: false, external: true },
        { id: 9, type: 'unknown', selected: false, external: false },
      ]),
    ).toEqual({
      video: [{ id: 1, label: '视频 1', selected: true }],
      audio: [
        { id: 1, label: 'jpn', language: 'jpn', selected: true },
        { id: 2, label: 'Commentary', language: 'eng', selected: false },
      ],
      text: [{ id: 1, label: '字幕 1', selected: false }],
    });
  });
});

describe('classifyMpvError', () => {
  const before = { loaded: false, url: 'https://cdn/a.m3u8' };
  const after = { loaded: true, url: 'https://cdn/a.m3u8' };

  it.each([
    ['unknown format code', { code: MpvError.UNKNOWN_FORMAT, message: 'unrecognized file format' }, before, 'format'],
    ['nothing to play', { code: MpvError.NOTHING_TO_PLAY, message: 'no audio or video data played' }, before, 'format'],
    ['format in the log', { code: MpvError.LOADING_FAILED, message: 'loading failed', log: 'cplayer: Failed to recognize file format.' }, before, 'format'],
    ['video output init', { code: MpvError.VO_INIT_FAILED, message: 'vo init failed' }, after, 'decoder'],
    ['audio output init', { code: MpvError.AO_INIT_FAILED, message: 'ao init failed' }, before, 'decoder'],
    ['HTTP error in the log', { code: MpvError.LOADING_FAILED, message: 'loading failed', log: 'ffmpeg: https: HTTP error 404 Not Found' }, before, 'network'],
    ['connection error in the log', { code: MpvError.LOADING_FAILED, message: 'loading failed', log: 'ffmpeg: tcp: Connection refused' }, after, 'network'],
    ['open failure before load', { code: MpvError.LOADING_FAILED, message: 'loading failed', log: 'cplayer: Opening failed or was aborted' }, before, 'open'],
    ['later failure on a network URL', { code: -20, message: 'something happened' }, after, 'network'],
  ] as const)('%s', (_name, error, context, reason) => {
    expect(classifyMpvError(error, context)).toBe(reason);
  });

  it('later failure on a local file -> other', () => {
    expect(classifyMpvError({ code: -20, message: 'generic' }, { loaded: true, url: 'file:///a.mkv' })).toBe('other');
  });
});

describe('createMpvEventMapper', () => {
  const tracks = [{ id: 1, type: 'audio', lang: 'chi', selected: true, external: false }];

  it('maps init failures to fatal init errors', () => {
    const map = createMpvEventMapper('https://cdn/a.m3u8');
    expect(map({ type: 'error', phase: 'init', code: 'load-library', message: 'missing' })).toEqual([
      { type: 'error', code: 'load-library', message: 'missing', fatal: true, phase: 'init', reason: 'init' },
    ]);
  });

  it('drops pause, buffering, progress and tracks until the file is loaded', () => {
    const map = createMpvEventMapper('https://cdn/a.m3u8');
    expect(map({ type: 'pause', value: false })).toEqual([]);
    expect(map({ type: 'buffering', value: false })).toEqual([]);
    expect(map({ type: 'progress', position: 1, duration: 2, buffered: 3 })).toEqual([]);
    expect(map({ type: 'tracks', tracks })).toEqual([]);
  });

  it('maps a loaded session to engine events in milliseconds', () => {
    const map = createMpvEventMapper('https://cdn/a.m3u8');
    expect(map({ type: 'loaded', duration: 120.25, tracks })).toEqual([
      { type: 'load', duration: 120_250, tracks: { audio: [{ id: 1, label: 'chi', language: 'chi', selected: true }], text: [], video: [] } },
    ]);
    expect(map({ type: 'progress', position: 10.5, duration: 120.25, buffered: 20 })).toEqual([
      { type: 'progress', position: 10_500, duration: 120_250, buffered: 20_000 },
    ]);
    expect(map({ type: 'pause', value: true })).toEqual([{ type: 'paused' }]);
    expect(map({ type: 'pause', value: true })).toEqual([]);
    expect(map({ type: 'pause', value: false })).toEqual([{ type: 'playing' }]);
    expect(map({ type: 'buffering', value: true })).toEqual([{ type: 'buffering', value: true }]);
    expect(map({ type: 'tracks', tracks: [] })).toEqual([{ type: 'tracks', audio: [], text: [], video: [] }]);
    expect(map({ type: 'endFile', reason: MPV_END_FILE_EOF, code: 0, message: 'success' })).toEqual([{ type: 'ended' }]);
  });

  it('classifies end-file errors with the load state', () => {
    const map = createMpvEventMapper('https://cdn/a.m3u8');
    const error = { type: 'endFile', reason: MPV_END_FILE_ERROR, code: MpvError.LOADING_FAILED, message: 'loading failed' } as const;
    expect(map({ ...error, log: 'cplayer: Opening failed or was aborted' })).toEqual([
      {
        type: 'error',
        code: MpvError.LOADING_FAILED,
        message: 'loading failed: cplayer: Opening failed or was aborted',
        fatal: true,
        phase: 'playback',
        reason: 'open',
      },
    ]);
    map({ type: 'loaded', duration: 10, tracks: [] });
    expect(map(error)).toMatchObject([{ type: 'error', phase: 'playback', reason: 'network' }]);
  });

  it('ignores other end-file reasons (stop, redirect)', () => {
    const map = createMpvEventMapper('https://cdn/a.m3u8');
    expect(map({ type: 'endFile', reason: 2, code: 0, message: 'success' })).toEqual([]);
  });
});
