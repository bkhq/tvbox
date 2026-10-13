import { parseEpisodes } from '../../core/types';
import type { EngineSource } from '../engine/types';
import {
  episodeIndexForFlag,
  initialPlaybackState,
  isPlaying,
  MSG_NO_ENGINE,
  MSG_NO_EPISODE,
  MSG_NO_NEXT,
  MSG_NO_PREV,
  MSG_PLAY_FAILED,
  type PlaybackAction,
  type PlaybackState,
  playbackReducer,
  selectEpisode,
  selectHasNext,
  selectHasPrev,
  selectQualityLabel,
} from '../machine';

const source = (url = 'http://a/1.m3u8', startPosition?: number): EngineSource => ({ url, headers: {}, subtitles: [], startPosition });
const flags = [
  { flag: 'line1', episodes: parseEpisodes('E1$u1#E2$u2#E3$u3') },
  { flag: 'line2', episodes: parseEpisodes('E1$v1') },
];
const tracks = { audio: [], text: [], video: [] };

function run(...actions: PlaybackAction[]): PlaybackState {
  return actions.reduce(playbackReducer, initialPlaybackState);
}

function openVod(episodeIndex = 0, revPlay = false): PlaybackState {
  const opened = run({ type: 'open', engine: 'video', speed: 1 });
  return playbackReducer(opened, { type: 'episodes', token: opened.token, flags, flagIndex: 0, episodeIndex, revPlay, title: 'Show' });
}

function playing(state: PlaybackState, url = 'http://a/1.m3u8'): PlaybackState {
  const actions: PlaybackAction[] = [
    { type: 'resolved', token: state.token, source: source(url) },
    { type: 'engine', event: { type: 'load', duration: 1000, tracks } },
  ];
  return actions.reduce(playbackReducer, state);
}

describe('playback machine', () => {
  it('walks idle -> resolving -> parsing -> loading -> playing -> paused', () => {
    let state = openVod();
    expect(state.status).toBe('resolving');
    expect(selectEpisode(state)?.name).toBe('E1');
    state = playbackReducer(state, { type: 'parsing', token: state.token });
    expect(state.status).toBe('parsing');
    state = playbackReducer(state, { type: 'resolved', token: state.token, source: source('x', 5000) });
    expect(state).toMatchObject({ status: 'loading', position: 5000, attempt: 1 });
    state = playbackReducer(state, { type: 'engine', event: { type: 'buffering', value: true } });
    expect(state.status).toBe('buffering');
    state = playbackReducer(state, { type: 'engine', event: { type: 'load', duration: 9000, tracks } });
    expect(state).toMatchObject({ status: 'playing', duration: 9000, loaded: true });
    expect(isPlaying(state)).toBe(true);
    state = playbackReducer(state, { type: 'togglePause' });
    expect(state).toMatchObject({ status: 'paused', paused: true });
    state = playbackReducer(state, { type: 'play' });
    expect(state.status).toBe('playing');
    state = playbackReducer(state, { type: 'engine', event: { type: 'progress', position: 3000, duration: 9000, buffered: 4000 } });
    expect(state).toMatchObject({ position: 3000, buffered: 4000 });
    state = playbackReducer(state, { type: 'stop' });
    expect(state.status).toBe('idle');
  });

  it('opens a direct URL straight into loading', () => {
    const state = run({ type: 'open', engine: 'mpv', speed: 1.5, title: 'T', source: source('u', 100) });
    expect(state).toMatchObject({ status: 'loading', engine: 'mpv', speed: 1.5, title: 'T', position: 100 });
  });

  it('errors without an engine', () => {
    expect(run({ type: 'open', speed: 1 })).toMatchObject({ status: 'error', error: MSG_NO_ENGINE });
  });

  it('drops stale async results', () => {
    const state = openVod();
    const next = playbackReducer(state, { type: 'next' });
    expect(playbackReducer(next, { type: 'resolved', token: state.token, source: source() })).toBe(next);
    expect(playbackReducer(next, { type: 'failed', token: state.token, message: 'x' })).toBe(next);
  });

  it('fails resolve with the given message', () => {
    const state = openVod();
    expect(playbackReducer(state, { type: 'failed', token: state.token, message: '暂不支持网页解析' })).toMatchObject({
      status: 'error',
      error: '暂不支持网页解析',
    });
  });

  describe('engine fallback', () => {
    it('switches once to the fallback keeping the position', () => {
      let state = playing(openVod());
      state = playbackReducer(state, { type: 'engine', event: { type: 'progress', position: 4200, duration: 9000, buffered: 0 } });
      state = playbackReducer(state, { type: 'engineFailed', message: 'decoder', fallback: 'mpv' });
      expect(state).toMatchObject({ status: 'loading', engine: 'mpv', fallbackUsed: true, loaded: false, attempt: 2 });
      expect(state.source?.startPosition).toBe(4200);
      state = playbackReducer(state, { type: 'engineFailed', message: 'again', fallback: 'video' });
      expect(state).toMatchObject({ status: 'error', error: `${MSG_PLAY_FAILED}：again` });
    });

    it('falls back on init errors before load', () => {
      let state = openVod();
      state = playbackReducer(state, { type: 'resolved', token: state.token, source: source('u', 700) });
      state = playbackReducer(state, { type: 'engineFailed', message: 'init', fallback: 'mpv' });
      expect(state).toMatchObject({ status: 'loading', engine: 'mpv' });
      expect(state.source?.startPosition).toBe(700);
    });

    it('errors when there is no fallback', () => {
      const state = playbackReducer(playing(openVod()), { type: 'engineFailed', message: '' });
      expect(state).toMatchObject({ status: 'error', error: MSG_PLAY_FAILED });
    });

    it('returns to the preferred engine for the next item', () => {
      let state = playbackReducer(playing(openVod()), { type: 'engineFailed', message: 'x', fallback: 'mpv' });
      state = playbackReducer(state, { type: 'next' });
      expect(state).toMatchObject({ engine: 'video', fallbackUsed: false, status: 'resolving' });
    });

    it('treats fatal engine error events without fallback as terminal', () => {
      const state = playbackReducer(playing(openVod()), {
        type: 'engine',
        event: { type: 'error', code: 1, message: 'boom', fatal: true, phase: 'playback', reason: 'network' },
      });
      expect(state.status).toBe('error');
    });
  });

  describe('episodes', () => {
    it('auto-advances on ended and stops at the last episode', () => {
      let state = playing(openVod(1));
      const token = state.token;
      state = playbackReducer(state, { type: 'engine', event: { type: 'ended' } });
      expect(state).toMatchObject({ status: 'resolving', episodeIndex: 2 });
      expect(state.token).toBe(token + 1);
      state = playbackReducer(playing(state), { type: 'engine', event: { type: 'ended' } });
      expect(state.status).toBe('ended');
    });

    it('replays the current item on ended with repeat on', () => {
      let state = playbackReducer(playing(openVod()), { type: 'repeat' });
      expect(state.repeat).toBe(true);
      state = playbackReducer(state, { type: 'engine', event: { type: 'ended' } });
      expect(state).toMatchObject({ status: 'loading', episodeIndex: 0, position: 0, attempt: 2 });
      expect(state.source?.startPosition).toBe(0);
    });

    it('replays from 0', () => {
      let state = playing(openVod());
      state = playbackReducer(state, { type: 'engine', event: { type: 'progress', position: 500, duration: 1000, buffered: 0 } });
      state = playbackReducer(state, { type: 'replay' });
      expect(state).toMatchObject({ status: 'loading', position: 0 });
      expect(state.source?.startPosition).toBe(0);
    });

    it('moves next / prev and reports the ends', () => {
      let state = openVod();
      expect(selectHasPrev(state)).toBe(false);
      state = playbackReducer(state, { type: 'prev' });
      expect(state.notice).toBe(MSG_NO_PREV);
      state = playbackReducer(state, { type: 'next' });
      expect(state.episodeIndex).toBe(1);
      state = playbackReducer(playbackReducer(state, { type: 'next' }), { type: 'next' });
      expect(state).toMatchObject({ episodeIndex: 2, notice: MSG_NO_NEXT });
    });

    it('walks backwards with revPlay', () => {
      let state = openVod(1, true);
      expect(selectHasNext(state)).toBe(true);
      state = playbackReducer(state, { type: 'next' });
      expect(state.episodeIndex).toBe(0);
      state = playbackReducer(state, { type: 'prev' });
      expect(state.episodeIndex).toBe(1);
      state = playbackReducer(playing(state), { type: 'engine', event: { type: 'ended' } });
      expect(state.episodeIndex).toBe(0);
    });

    it('selects an episode on another flag', () => {
      const state = playbackReducer(openVod(), { type: 'selectEpisode', flagIndex: 1, episodeIndex: 0 });
      expect(selectEpisode(state)?.url).toBe('v1');
      expect(playbackReducer(state, { type: 'selectEpisode', flagIndex: 1, episodeIndex: 5 })).toBe(state);
    });
  });

  describe('line fallback', () => {
    const lines = [
      { flag: 'bad', episodes: parseEpisodes('E1$u1#E2$u2') },
      { flag: 'empty', episodes: [] },
      { flag: 'good', episodes: parseEpisodes('E2$w2#E1$w1') },
      { flag: 'last', episodes: parseEpisodes('E1$x1') },
    ];

    function openLines(changeable = true, flagIndex = 0, episodeIndex = 0): PlaybackState {
      const opened = run({ type: 'open', engine: 'video', speed: 1 });
      return playbackReducer(opened, { type: 'episodes', token: opened.token, flags: lines, flagIndex, episodeIndex, changeable });
    }

    it('moves a failed resolve to the same episode on the next line with a notice', () => {
      const state = openLines();
      const next = playbackReducer(state, { type: 'failed', token: state.token, message: '404' });
      expect(next).toMatchObject({ status: 'resolving', flagIndex: 2, episodeIndex: 1, notice: '正在切换线路至「good」', triedFlags: [0, 2] });
      expect(next.token).toBe(state.token + 1);
      expect(selectEpisode(next)?.url).toBe('w1');
    });

    it('uses the engine fallback before the next line', () => {
      let state = playing(openLines());
      state = playbackReducer(state, { type: 'engineFailed', message: 'decoder', fallback: 'mpv' });
      expect(state).toMatchObject({ status: 'loading', engine: 'mpv', flagIndex: 0 });
      state = playbackReducer(state, { type: 'engineFailed', message: 'again', fallback: 'video' });
      expect(state).toMatchObject({ status: 'resolving', engine: 'video', fallbackUsed: false, flagIndex: 2 });
    });

    it('stops after every line was tried with the last failure', () => {
      let state = openLines();
      state = playbackReducer(state, { type: 'failed', token: state.token, message: 'a' });
      state = playbackReducer(state, { type: 'failed', token: state.token, message: 'b' });
      expect(state).toMatchObject({ flagIndex: 3, triedFlags: [0, 2, 3] });
      state = playbackReducer(state, { type: 'failed', token: state.token, message: 'c' });
      expect(state).toMatchObject({ status: 'error', error: 'c', flagIndex: 3 });
    });

    it('leaves an empty current line', () => {
      expect(openLines(true, 1)).toMatchObject({ status: 'resolving', flagIndex: 2, notice: '正在切换线路至「good」' });
      expect(openLines(false, 1)).toMatchObject({ status: 'error', error: MSG_NO_EPISODE });
    });

    it('fails as before when the site is not changeable', () => {
      const state = openLines(false);
      expect(playbackReducer(state, { type: 'failed', token: state.token, message: '404' })).toMatchObject({ status: 'error', error: '404' });
    });

    it('resets the tried lines on a manual selection', () => {
      let state = openLines();
      state = playbackReducer(state, { type: 'failed', token: state.token, message: 'a' });
      state = playbackReducer(state, { type: 'selectEpisode', flagIndex: 0, episodeIndex: 1 });
      expect(state.triedFlags).toEqual([0]);
      state = playbackReducer(state, { type: 'failed', token: state.token, message: 'b' });
      expect(state).toMatchObject({ status: 'resolving', flagIndex: 2, episodeIndex: 0 });
    });
  });

  describe('video size', () => {
    const sized = (width: number, height: number): PlaybackAction => ({ type: 'engine', event: { type: 'load', duration: 1000, tracks, width, height } });

    it('stores the size from load and resets it for a new item or engine', () => {
      const state = playbackReducer(playing(openVod()), sized(1920, 1080));
      expect(state.videoSize).toEqual({ width: 1920, height: 1080 });
      expect(playbackReducer(state, { type: 'next' }).videoSize).toBeUndefined();
      expect(playbackReducer(state, { type: 'setEngine', engine: 'mpv' }).videoSize).toBeUndefined();
      expect(run({ type: 'open', engine: 'video', speed: 1, source: source() }).videoSize).toBeUndefined();
      expect(playing(openVod()).videoSize).toBeUndefined();
    });

    it.each([
      [3840, 2160, '4K'],
      [3840, 1600, '4K'],
      [2560, 1440, '2K'],
      [1920, 1080, '1080P'],
      [1280, 720, '720P'],
      [640, 360, undefined],
    ])('labels %ix%i as %s', (width, height, label) => {
      expect(selectQualityLabel(playbackReducer(playing(openVod()), sized(width, height)))).toBe(label);
    });

    it('has no label while the size is unknown', () => {
      expect(selectQualityLabel(playing(openVod()))).toBeUndefined();
      expect(selectQualityLabel(initialPlaybackState)).toBeUndefined();
    });
  });

  describe('episodeIndexForFlag', () => {
    const lines = [
      { flag: 'a', episodes: parseEpisodes('E1$a1#E2$a2#E3$a3') },
      { flag: 'b', episodes: parseEpisodes('E0$b0#E3$b3') },
      { flag: 'c', episodes: parseEpisodes('X1$c1') },
      { flag: 'd', episodes: [] },
    ];
    const at = (episodeIndex: number): PlaybackState => ({ ...initialPlaybackState, flags: lines, flagIndex: 0, episodeIndex });

    it('picks the episode with the same name', () => {
      expect(episodeIndexForFlag(at(2), 1)).toBe(1);
    });

    it('falls back to the same index clamped to the line', () => {
      expect(episodeIndexForFlag(at(1), 1)).toBe(1);
      expect(episodeIndexForFlag(at(2), 2)).toBe(0);
    });

    it('returns 0 for an empty or unknown line', () => {
      expect(episodeIndexForFlag(at(2), 3)).toBe(0);
      expect(episodeIndexForFlag(at(2), 9)).toBe(0);
    });
  });

  it('switches engine manually keeping position', () => {
    let state = playing(openVod());
    state = playbackReducer(state, { type: 'seek', position: 800 });
    state = playbackReducer(state, { type: 'setEngine', engine: 'mpv' });
    expect(state).toMatchObject({ engine: 'mpv', status: 'loading', fallbackUsed: false });
    expect(state.source?.startPosition).toBe(800);
  });

  it('sets speed, tracks and subtitles', () => {
    let state = playing(openVod());
    state = playbackReducer(state, { type: 'setSpeed', speed: 2 });
    state = playbackReducer(state, { type: 'setSpeed', speed: -1 });
    state = playbackReducer(state, { type: 'selectTrack', kind: 'text', id: null });
    state = playbackReducer(state, { type: 'selectTrack', kind: 'audio', id: 2 });
    state = playbackReducer(state, { type: 'addSubtitle', subtitle: { url: 's.vtt', name: 'zh' } });
    expect(state).toMatchObject({ speed: 2, textTrack: null, audioTrack: 2, status: 'loading' });
    expect(state.source?.subtitles).toEqual([{ url: 's.vtt', name: 'zh' }]);
  });
});
