/**
 * Playback state machine: a pure reducer plus selectors, no React. Follows
 * playback/vod/VodPlaybackController.java (episode navigation, ended ->
 * next episode) and PlayerManager.java (resolve -> parse -> start); engine
 * fallback switches once to the other engine keeping the position; when that
 * is exhausted (or resolving fails) a changeable site moves on to the same
 * episode on the next line (fallback.ts).
 *
 *   idle -> resolving -> (parsing) -> loading -> buffering | playing | paused -> ended | error
 *
 * Every new item (open, episode change, re-resolve) bumps `token`; async
 * results carry the token they were started for and stale ones are dropped.
 * `attempt` is bumped whenever a new source is handed to an engine, so the
 * screen can key the engine view on it.
 */

import type { Episode, Flag } from '../core/types';
import { nextLine, switchLineNotice } from './fallback';
import type { EngineEvent, EngineKind, EngineSource, EngineTracks, ExternalSubtitle, TrackId } from './engine/types';

export type PlaybackStatus =
  | 'idle'
  | 'resolving'
  | 'parsing'
  | 'loading'
  | 'buffering'
  | 'playing'
  | 'paused'
  | 'ended'
  | 'error';

export interface PlaybackState {
  status: PlaybackStatus;
  token: number;
  attempt: number;
  /** Vod name or the direct URL's title. */
  title: string;
  flags: Flag[];
  flagIndex: number;
  episodeIndex: number;
  /** History.revPlay: next / prev walk the episode list backwards. */
  revPlay: boolean;
  source?: EngineSource;
  /** Engine chosen on open; every new item starts on it again. */
  preferredEngine?: EngineKind;
  engine?: EngineKind;
  /** The one engine fallback of the current item has been used. */
  fallbackUsed: boolean;
  /** The site allows automatic line fallback (Site.isChangeable). */
  changeable: boolean;
  /** Flag indices tried for the current episode request. */
  triedFlags: number[];
  /** The engine reported `load` for the current source. */
  loaded: boolean;
  /** User intent; the engine view's `paused` prop. */
  paused: boolean;
  /** Repeat the current item instead of advancing on ended. */
  repeat: boolean;
  position: number;
  duration: number;
  buffered: number;
  speed: number;
  tracks: EngineTracks;
  audioTrack?: TrackId;
  textTrack?: TrackId | null;
  error?: string;
  /** Transient message for the UI (e.g. no next episode). */
  notice?: string;
}

export type PlaybackAction =
  /** Starts a new item. A direct URL passes its source; VOD items resolve next. */
  | { type: 'open'; title?: string; engine?: EngineKind; speed: number; source?: EngineSource }
  /** VOD detail loaded: the play sources and the episode to start with. */
  | {
      type: 'episodes';
      token: number;
      flags: Flag[];
      flagIndex: number;
      episodeIndex: number;
      revPlay?: boolean;
      title?: string;
      changeable?: boolean;
    }
  | { type: 'parsing'; token: number }
  /** `engine` overrides the active engine for this item (e.g. DRM sources). */
  | { type: 'resolved'; token: number; source: EngineSource; engine?: EngineKind }
  | { type: 'failed'; token: number; message: string }
  | { type: 'engine'; event: EngineEvent }
  /** Engine init or fatal playback error; `fallback` is the other available engine. */
  | { type: 'engineFailed'; message: string; fallback?: EngineKind }
  /** Manual engine switch keeping the position. */
  | { type: 'setEngine'; engine: EngineKind }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'togglePause' }
  | { type: 'seek'; position: number }
  | { type: 'setSpeed'; speed: number }
  | { type: 'selectEpisode'; episodeIndex: number; flagIndex?: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'repeat' }
  | { type: 'replay' }
  | { type: 'selectTrack'; kind: 'audio' | 'text'; id: TrackId | null }
  | { type: 'addSubtitle'; subtitle: ExternalSubtitle }
  | { type: 'stop' };

export const MSG_NO_ENGINE = '没有可用的播放器';
export const MSG_NO_EPISODE = '暂无播放数据';
export const MSG_PLAY_FAILED = '播放地址加载失败';
export const MSG_NO_NEXT = '已经是最后一集了！';
export const MSG_NO_PREV = '已经是第一集了！';

const NO_TRACKS: EngineTracks = { audio: [], text: [], video: [] };

export const initialPlaybackState: PlaybackState = {
  status: 'idle',
  token: 0,
  attempt: 0,
  title: '',
  flags: [],
  flagIndex: 0,
  episodeIndex: 0,
  revPlay: false,
  fallbackUsed: false,
  changeable: false,
  triedFlags: [],
  loaded: false,
  paused: false,
  repeat: false,
  position: 0,
  duration: 0,
  buffered: 0,
  speed: 1,
  tracks: NO_TRACKS,
};

// ---------------------------------------------------------------------------
// Selectors

export function selectFlag(state: PlaybackState): Flag | undefined {
  return state.flags[state.flagIndex];
}

export function selectEpisode(state: PlaybackState): Episode | undefined {
  return selectFlag(state)?.episodes[state.episodeIndex];
}

/** Index of the next (+1) or previous (-1) episode honouring revPlay; undefined at the end of the list. */
export function relativeEpisodeIndex(state: PlaybackState, direction: 1 | -1): number | undefined {
  const episodes = selectFlag(state)?.episodes ?? [];
  const index = state.episodeIndex + (state.revPlay ? -direction : direction);
  return index >= 0 && index < episodes.length ? index : undefined;
}

export const selectHasNext = (state: PlaybackState) => relativeEpisodeIndex(state, 1) !== undefined;
export const selectHasPrev = (state: PlaybackState) => relativeEpisodeIndex(state, -1) !== undefined;

export const isActive = (state: PlaybackState) => state.status !== 'idle';

/** Playing or about to (buffering while not paused). */
export function isPlaying(state: PlaybackState): boolean {
  return state.status === 'playing' || ((state.status === 'buffering' || state.status === 'loading') && !state.paused);
}

/** States in which an engine has a source and reports events. */
function hasMedia(state: PlaybackState): boolean {
  return ['loading', 'buffering', 'playing', 'paused'].includes(state.status);
}

// ---------------------------------------------------------------------------
// Reducer

/** Fields reset for every new item. */
function newItem(state: PlaybackState): PlaybackState {
  return {
    ...state,
    status: 'resolving',
    token: state.token + 1,
    source: undefined,
    engine: state.preferredEngine,
    fallbackUsed: false,
    loaded: false,
    position: 0,
    duration: 0,
    buffered: 0,
    tracks: NO_TRACKS,
    audioTrack: undefined,
    textTrack: undefined,
    error: undefined,
    notice: undefined,
  };
}

function toEpisode(state: PlaybackState, episodeIndex: number, flagIndex = state.flagIndex): PlaybackState {
  const episodes = state.flags[flagIndex]?.episodes ?? [];
  if (episodeIndex < 0 || episodeIndex >= episodes.length) return state;
  return { ...newItem(state), flagIndex, episodeIndex, triedFlags: [flagIndex] };
}

/** VodFallbackPolicy.fallbackToNextLine: the same episode on the next line, else the error. */
function failOrNextLine(state: PlaybackState, message: string): PlaybackState {
  const target = state.changeable ? nextLine({ ...state, tried: state.triedFlags }) : undefined;
  if (!target) return fail(state, message);
  return {
    ...newItem(state),
    flagIndex: target.flagIndex,
    episodeIndex: target.episodeIndex,
    triedFlags: [...state.triedFlags, target.flagIndex],
    notice: switchLineNotice(state.flags[target.flagIndex]?.flag ?? ''),
  };
}

function step(state: PlaybackState, direction: 1 | -1): PlaybackState {
  if (state.flags.length === 0) return state;
  const index = relativeEpisodeIndex(state, direction);
  if (index === undefined) return { ...state, notice: direction === 1 ? MSG_NO_NEXT : MSG_NO_PREV };
  return toEpisode(state, index);
}

/** Restarts the current source from 0, or re-resolves the item when there is none. */
function replay(state: PlaybackState): PlaybackState {
  if (state.status === 'idle') return state;
  if (!state.source) return state.flags.length > 0 ? newItem(state) : state;
  return {
    ...state,
    status: 'loading',
    attempt: state.attempt + 1,
    loaded: false,
    source: { ...state.source, startPosition: 0 },
    paused: false,
    position: 0,
    error: undefined,
    notice: undefined,
  };
}

function switchEngine(state: PlaybackState, engine: EngineKind): PlaybackState {
  if (!state.source) return { ...state, engine };
  const startPosition = state.position > 0 ? state.position : state.source.startPosition;
  return { ...state, engine, status: 'loading', attempt: state.attempt + 1, loaded: false, source: { ...state.source, startPosition } };
}

function fail(state: PlaybackState, message: string): PlaybackState {
  return { ...state, status: 'error', error: message };
}

function onEnded(state: PlaybackState): PlaybackState {
  if (state.repeat) return replay(state);
  const next = relativeEpisodeIndex(state, 1);
  if (state.flags.length > 0 && next !== undefined) return toEpisode(state, next);
  return { ...state, status: 'ended', position: state.duration || state.position };
}

function onEngineEvent(state: PlaybackState, event: EngineEvent): PlaybackState {
  if (!hasMedia(state)) return state;
  switch (event.type) {
    case 'load':
      return {
        ...state,
        status: state.paused ? 'paused' : 'playing',
        loaded: true,
        duration: event.duration,
        tracks: event.tracks,
      };
    case 'progress':
      return { ...state, position: event.position, duration: event.duration, buffered: event.buffered };
    case 'buffering':
      if (event.value) return state.status === 'paused' ? state : { ...state, status: 'buffering' };
      return state.status === 'buffering' || state.status === 'loading'
        ? { ...state, status: state.paused ? 'paused' : 'playing' }
        : state;
    case 'playing':
      return { ...state, status: 'playing', paused: false };
    case 'paused':
      return { ...state, status: 'paused', paused: true };
    case 'ended':
      return onEnded(state);
    case 'tracks':
      return { ...state, tracks: { audio: event.audio, text: event.text, video: event.video } };
    case 'error':
      return event.fatal ? engineFailed(state, event.message, undefined) : state;
  }
}

function engineFailed(state: PlaybackState, message: string, fallback: EngineKind | undefined): PlaybackState {
  if (!hasMedia(state)) return state;
  if (!state.fallbackUsed && fallback && fallback !== state.engine) {
    return { ...switchEngine(state, fallback), fallbackUsed: true };
  }
  return failOrNextLine(state, message ? `${MSG_PLAY_FAILED}：${message}` : MSG_PLAY_FAILED);
}

export function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case 'open': {
      const opened: PlaybackState = {
        ...newItem(state),
        title: action.title ?? '',
        flags: [],
        flagIndex: 0,
        episodeIndex: 0,
        revPlay: false,
        changeable: false,
        triedFlags: [],
        preferredEngine: action.engine,
        engine: action.engine,
        paused: false,
        speed: action.speed,
      };
      if (!action.engine) return fail(opened, MSG_NO_ENGINE);
      if (!action.source) return opened;
      return { ...opened, status: 'loading', attempt: state.attempt + 1, source: action.source, position: action.source.startPosition ?? 0 };
    }
    case 'episodes': {
      if (action.token !== state.token || state.status !== 'resolving') return state;
      const next = {
        ...state,
        flags: action.flags,
        flagIndex: action.flagIndex,
        episodeIndex: action.episodeIndex,
        revPlay: action.revPlay ?? false,
        title: action.title ?? state.title,
        changeable: action.changeable ?? false,
        triedFlags: [action.flagIndex],
      };
      return selectEpisode(next) ? next : failOrNextLine(next, MSG_NO_EPISODE);
    }
    case 'parsing':
      return action.token === state.token && state.status === 'resolving' ? { ...state, status: 'parsing' } : state;
    case 'resolved':
      if (action.token !== state.token || (state.status !== 'resolving' && state.status !== 'parsing')) return state;
      return {
        ...state,
        status: 'loading',
        attempt: state.attempt + 1,
        engine: action.engine ?? state.engine,
        source: action.source,
        position: action.source.startPosition ?? 0,
      };
    case 'failed':
      if (action.token !== state.token || (state.status !== 'resolving' && state.status !== 'parsing')) return state;
      return failOrNextLine(state, action.message);
    case 'engine':
      return onEngineEvent(state, action.event);
    case 'engineFailed':
      return engineFailed(state, action.message, action.fallback);
    case 'setEngine':
      if (action.engine === state.engine) return state;
      return hasMedia(state) ? switchEngine(state, action.engine) : { ...state, engine: action.engine };
    case 'play':
      if (state.status === 'ended') return replay(state);
      return { ...state, paused: false, status: state.status === 'paused' ? 'playing' : state.status };
    case 'pause':
      return {
        ...state,
        paused: true,
        status: state.status === 'playing' || state.status === 'buffering' ? 'paused' : state.status,
      };
    case 'togglePause':
      return playbackReducer(state, { type: isPlaying(state) ? 'pause' : 'play' });
    case 'seek': {
      if (!state.source) return state;
      const position = Math.max(0, action.position);
      return state.status === 'ended' ? { ...state, position, status: 'playing', paused: false } : { ...state, position };
    }
    case 'setSpeed':
      return action.speed > 0 && Number.isFinite(action.speed) ? { ...state, speed: action.speed } : state;
    case 'selectEpisode':
      return toEpisode(state, action.episodeIndex, action.flagIndex);
    case 'next':
      return step(state, 1);
    case 'prev':
      return step(state, -1);
    case 'repeat':
      return { ...state, repeat: !state.repeat };
    case 'replay':
      return replay(state);
    case 'selectTrack':
      return action.kind === 'audio'
        ? { ...state, audioTrack: action.id ?? undefined }
        : { ...state, textTrack: action.id };
    case 'addSubtitle': {
      if (!state.source) return state;
      const others = state.source.subtitles.filter((item) => item.url !== action.subtitle.url);
      const startPosition = state.position > 0 ? state.position : state.source.startPosition;
      return {
        ...state,
        status: 'loading',
        attempt: state.attempt + 1,
        loaded: false,
        source: { ...state.source, startPosition, subtitles: [action.subtitle, ...others] },
      };
    }
    case 'stop':
      return { ...initialPlaybackState, token: state.token + 1, attempt: state.attempt, repeat: state.repeat };
  }
}
