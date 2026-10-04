import { parseEpisodes } from '../../core/types';
import type { EngineSource } from '../engine/types';
import {
  initialPlaybackState,
  isPlaying,
  MSG_NO_ENGINE,
  MSG_NO_NEXT,
  MSG_NO_PREV,
  MSG_PLAY_FAILED,
  type PlaybackAction,
  type PlaybackState,
  playbackReducer,
  selectEpisode,
  selectHasNext,
  selectHasPrev,
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
