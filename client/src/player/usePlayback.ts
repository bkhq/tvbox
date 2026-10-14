/**
 * usePlayback: wires settings, the VOD resolve flow, the state machine,
 * history and the app-wide controller for the Player screen. The screen
 * renders `engine.Component` with `source` (keyed on `sourceKey`), passes
 * `setEngineHandle` as its ref callback and `onEngineEvent` as its onEvent.
 * Destructure the result before rendering: the react-hooks lint treats an
 * object whose member is passed as `ref` as a ref.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { Platform } from 'react-native';

import sniffer from '../../modules/sniffer';
import { useVodConfig } from '../core/bootstrap';
import { type FetchLike, mergeHeaders } from '../core/http';
import type { SiteProvider } from '../core/provider';
import { appSettings, type SettingsStore } from '../core/settings/settings';
import { parseSetting } from '../core/settings/schema';
import { useSetting } from '../core/settings/useSetting';
import { historyKey } from '../core/storage';
import type { Site } from '../core/types';
import { getHistoryRepository } from '../core/userData';
import { attachPlaybackHost, type PlaybackSnapshot, type PlayUrlRequest, type SnapshotListener } from './controller';
import { chooseEngine, type EnginePreference, fallbackDecision } from './engine/policy';
import { getEngine, resolveEngine } from './engine/registry';
import {
  type EngineEvent,
  type EngineFactory,
  type EngineHandle,
  type EngineKind,
  type EngineSource,
  type ExternalSubtitle,
  type ResizeMode,
  resizeModeFromScale,
  type TrackId,
} from './engine/types';
import { createHistoryTracker, type HistoryTracker, pickEpisode, shouldSkipEnding, startPosition } from './history';
import {
  episodeIndexForFlag,
  initialPlaybackState,
  isActive,
  isPlaying,
  type PlaybackState,
  playbackReducer,
  selectEpisode as selectCurrentEpisode,
  selectFlag,
} from './machine';
import { isUrlPlayerParams, type PlayerParams, type VodPlayerParams } from './params';
import { errorMessage, loadVod, type ResolveDeps, resolvePlayer, runParse, withUserAgent } from './resolve';
import { sniffMedia } from './sniff';

export interface UsePlaybackOptions {
  settings?: SettingsStore;
  fetch?: FetchLike;
  getProvider?: (site: Site) => SiteProvider;
  /** Attach as the app-wide playback host (default true); the screen passes its focus state. */
  attach?: boolean;
  /** Receives the load-timeout error instead of onEngineEvent (a screen that wraps onEngineEvent). */
  onLoadTimeout?(event: EngineEvent): void;
}

/** Milliseconds an engine may take to report `load` for a source before it counts as failed. */
export const LOAD_TIMEOUT = 15_000;

const LOAD_TIMEOUT_ERROR: EngineEvent = {
  type: 'error',
  code: 'timeout',
  message: '加载超时',
  fatal: true,
  phase: 'init',
  reason: 'init',
};

export interface UsePlayback {
  state: PlaybackState;
  /** Source for the engine view; undefined until resolved. */
  source?: EngineSource;
  /** Changes whenever the engine view must restart (new item, fallback, replay). */
  sourceKey: string;
  engine?: EngineFactory;
  resizeMode: ResizeMode;
  /** Ref callback for the engine component. */
  setEngineHandle(handle: EngineHandle | null): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(ms: number): void;
  next(): void;
  prev(): void;
  selectEpisode(episodeIndex: number, flagIndex?: number): void;
  /** Switches the play line keeping the episode (episodeIndexForFlag); no-op for the current or an unknown line. */
  switchFlag(flagIndex: number): void;
  setSpeed(speed: number): void;
  selectTrack(kind: 'audio' | 'text', id: TrackId | null): void;
  addSubtitle(subtitle: ExternalSubtitle): void;
  repeat(): void;
  replay(): void;
  stop(): void;
  /** Persists the preference and switches the running engine, keeping the position. */
  switchEngine(preference: EnginePreference): void;
  onEngineEvent(event: EngineEvent): void;
}

/** Persists the preferred engine (`playerEngine` setting); 'auto' restores the platform default. */
export function setPreferredEngine(preference: EnginePreference, settings: SettingsStore = appSettings): Promise<void> {
  return settings.set('playerEngine', preference);
}

/** The engine to open with: the setting (or platform default), else the other available one. */
export function pickEngine(settings: SettingsStore = appSettings, source?: EngineSource): EngineKind | undefined {
  return resolveEngine(chooseEngine(settings.get('playerEngine'), Platform.OS, source))?.kind;
}

export function toSnapshot(state: PlaybackState): PlaybackSnapshot {
  return {
    active: isActive(state),
    playing: isPlaying(state),
    title: state.source?.title ?? state.title,
    position: state.position,
    duration: state.duration,
    speed: state.speed,
    repeat: state.repeat,
    url: state.source?.url,
    engine: state.engine,
    status: state.status,
  };
}

function episodeTitle(state: PlaybackState): string {
  const episode = selectCurrentEpisode(state);
  return episode && state.title !== '' ? `${state.title} ${episode.name}` : (episode?.name ?? state.title);
}

export function usePlayback(params: PlayerParams, options: UsePlaybackOptions = {}): UsePlayback {
  const settings = options.settings ?? appSettings;
  const vodConfig = useVodConfig();
  const [scale] = useSetting('scale', settings);
  const [state, dispatch] = useReducer(playbackReducer, initialPlaybackState);
  const [request, setRequest] = useState<PlayerParams>(params);
  // Route params replace the request when they change by value (state adjusted during render).
  const paramsKey = JSON.stringify(params);
  const [seenParamsKey, setSeenParamsKey] = useState(paramsKey);
  if (seenParamsKey !== paramsKey) {
    setSeenParamsKey(paramsKey);
    setRequest(params);
  }
  const engineRef = useRef<EngineHandle | null>(null);
  const stateRef = useRef(state);
  const trackerRef = useRef<HistoryTracker | undefined>(undefined);
  const siteRef = useRef<Site | undefined>(undefined);
  const overrideRef = useRef<{ episodeUrl?: string; position?: number } | undefined>(undefined);
  const skippedRef = useRef(-1);
  const startedRef = useRef('');
  const optionsRef = useRef(options);
  const attach = options.attach ?? true;
  useEffect(() => {
    stateRef.current = state;
    optionsRef.current = options;
  });

  const config = vodConfig.status === 'ready' ? vodConfig.config : undefined;
  const cid = vodConfig.entry?.id ?? 0;

  // Open the request; a VOD request re-opens when the config reloads.
  const openedRef = useRef<PlayerParams | undefined>(undefined);
  useEffect(() => {
    if (isUrlPlayerParams(request) && openedRef.current === request) return;
    openedRef.current = request;
    const speed = settings.get('speedPlayback');
    void trackerRef.current?.flush();
    trackerRef.current = undefined;
    if (isUrlPlayerParams(request)) {
      const headers = withUserAgent(mergeHeaders(request.headers), settings.get('ua'));
      const source: EngineSource = { url: request.url, headers, title: request.title, startPosition: request.position, subtitles: [] };
      dispatch({ type: 'open', title: request.title, engine: pickEngine(settings, source), speed, source });
      return;
    }
    if (vodConfig.status === 'loading') return;
    const vodRequest = request as VodPlayerParams;
    siteRef.current = config?.sites.find((site) => site.key === vodRequest.siteKey);
    overrideRef.current = { episodeUrl: vodRequest.episodeUrl, position: vodRequest.position };
    if (siteRef.current) {
      trackerRef.current = createHistoryTracker({
        repo: getHistoryRepository(),
        cid,
        key: historyKey(vodRequest.siteKey, vodRequest.vodId),
        enabled: () => !settings.get('incognito'),
      });
    }
    dispatch({ type: 'open', engine: pickEngine(settings), speed });
  }, [request, config, cid, vodConfig.status, settings]);

  // Drive the VOD flow: detail -> episode -> player -> parse.
  useEffect(() => {
    if (state.status !== 'resolving' || isUrlPlayerParams(request)) return;
    const hasFlags = state.flags.length > 0;
    const stage = `${state.token}:${hasFlags}`;
    if (startedRef.current === stage) return;
    startedRef.current = stage;
    const { token } = state;
    const site = siteRef.current;
    const tracker = trackerRef.current;
    const { fetch, getProvider } = optionsRef.current;
    const fail = (error: unknown) => dispatch({ type: 'failed', token, message: errorMessage(error) });
    if (!site || !config) {
      dispatch({ type: 'failed', token, message: '站点不可用' });
      return;
    }
    const vodRequest = request as VodPlayerParams;

    if (!hasFlags) {
      (async () => {
        const { vod, flags } = await loadVod(site, vodRequest.vodId, { getProvider });
        const history = await tracker?.open({ vodName: vod.vod_name, vodPic: vod.vod_pic });
        const { flagIndex, episodeIndex } = pickEpisode(flags, vodRequest, history);
        const changeable = site.changeable === 1;
        dispatch({ type: 'episodes', token, flags, flagIndex, episodeIndex, revPlay: history?.revPlay, title: vod.vod_name, changeable });
      })().catch(fail);
      return;
    }

    const flag = selectFlag(state)!;
    const episode = selectCurrentEpisode(state)!;
    const title = episodeTitle(state);
    const deps: ResolveDeps = {
      config,
      ua: settings.get('ua'),
      fetch,
      getProvider,
      sniff: (sniffRequest) => sniffMedia(sniffRequest, { native: sniffer, rules: config.rules }),
    };
    (async () => {
      await tracker?.setEpisode(flag.flag, episode);
      const decision = await resolvePlayer(site, flag.flag, episode.url, deps);
      let media;
      if (decision.type === 'parse') {
        dispatch({ type: 'parsing', token });
        media = await runParse(decision.job, deps);
      } else {
        media = decision.media;
      }
      const override = overrideRef.current;
      overrideRef.current = undefined;
      const routePosition = override && override.episodeUrl === episode.url ? override.position : undefined;
      const start = startPosition(tracker?.current(), episode, routePosition ?? media.position);
      const { position: _position, from: _from, ...rest } = media;
      const source: EngineSource = { ...rest, title, startPosition: start };
      dispatch({ type: 'resolved', token, source, engine: source.drm ? pickEngine(settings, source) : undefined });
    })().catch(fail);
  }, [state, request, config, settings]);

  // Controller host.
  const pushRef = useRef(new Set<SnapshotListener>());
  useEffect(() => {
    const snapshot = toSnapshot(state);
    for (const push of [...pushRef.current]) push(snapshot);
  }, [state]);

  const setEngineHandle = useCallback((handle: EngineHandle | null) => {
    engineRef.current = handle;
  }, []);

  const seek = useCallback((ms: number) => {
    engineRef.current?.seek(Math.max(0, ms));
    dispatch({ type: 'seek', position: ms });
  }, []);

  const setSpeed = useCallback(
    (speed: number) => {
      const value = parseSetting('speedPlayback', speed);
      if (value === undefined) return;
      dispatch({ type: 'setSpeed', speed: value });
      void trackerRef.current?.setSpeed(value);
    },
    [],
  );

  const pause = useCallback(() => {
    dispatch({ type: 'pause' });
    void trackerRef.current?.flush();
  }, []);

  const stop = useCallback(() => {
    void trackerRef.current?.flush();
    dispatch({ type: 'stop' });
  }, []);

  const play = useCallback(() => dispatch({ type: 'play' }), []);
  const next = useCallback(() => dispatch({ type: 'next' }), []);
  const prev = useCallback(() => dispatch({ type: 'prev' }), []);
  const repeat = useCallback(() => dispatch({ type: 'repeat' }), []);
  const replay = useCallback(() => dispatch({ type: 'replay' }), []);

  useEffect(() => {
    if (!attach) return;
    const pushes = pushRef.current;
    const detach = attachPlaybackHost({
      play,
      pause,
      stop,
      prev,
      next,
      repeat,
      replay,
      seekTo: seek,
      setSpeed,
      getState: () => toSnapshot(stateRef.current),
      subscribe(push) {
        pushes.add(push);
        return () => {
          pushes.delete(push);
        };
      },
      playUrl(next: PlayUrlRequest) {
        const current = stateRef.current;
        setRequest((active) =>
          isUrlPlayerParams(active) && active.url === next.url && isActive(current) ? active : { ...next },
        );
      },
    });
    return () => {
      detach();
      void trackerRef.current?.flush();
    };
  }, [attach, play, pause, stop, prev, next, repeat, replay, seek, setSpeed]);

  const onEngineEvent = useCallback((event: EngineEvent) => {
    const current = stateRef.current;
    if (event.type === 'error') {
      if (!event.fatal && event.phase !== 'init') return;
      const decision = current.engine
        ? fallbackDecision(Platform.OS, current.engine, event, current)
        : undefined;
      const fallback = decision && getEngine(decision)?.isAvailable() ? decision : undefined;
      dispatch({ type: 'engineFailed', message: event.message, fallback });
      return;
    }
    dispatch({ type: 'engine', event });
    const tracker = trackerRef.current;
    if (!tracker) return;
    if (event.type === 'progress') {
      void tracker.progress(event.position, event.duration);
      if (skippedRef.current !== current.token && shouldSkipEnding(tracker.current(), event.position, event.duration)) {
        skippedRef.current = current.token;
        dispatch({ type: 'next' });
      }
    } else if (event.type === 'paused' || event.type === 'ended') {
      void tracker.flush();
    }
  }, []);

  // Load watchdog: an engine that never reports load or error (e.g. an idle native view) fails like an init error.
  const sourceKey = `${state.engine ?? ''}:${state.attempt}`;
  const awaitingLoad = state.source !== undefined && state.engine !== undefined && !state.loaded && state.status !== 'error';
  useEffect(() => {
    if (!awaitingLoad) return;
    const timer = setTimeout(() => (optionsRef.current.onLoadTimeout ?? onEngineEvent)(LOAD_TIMEOUT_ERROR), LOAD_TIMEOUT);
    return () => clearTimeout(timer);
  }, [awaitingLoad, sourceKey, onEngineEvent]);

  const switchEngine = useCallback(
    (preference: EnginePreference) => {
      void setPreferredEngine(preference, settings);
      const kind = chooseEngine(preference, Platform.OS, stateRef.current.source);
      if (getEngine(kind)?.isAvailable()) dispatch({ type: 'setEngine', engine: kind });
    },
    [settings],
  );

  const switchFlag = useCallback((flagIndex: number) => {
    const current = stateRef.current;
    if (flagIndex === current.flagIndex || flagIndex < 0 || flagIndex >= current.flags.length) return;
    dispatch({ type: 'selectEpisode', episodeIndex: episodeIndexForFlag(current, flagIndex), flagIndex });
  }, []);

  const engine = state.engine ? getEngine(state.engine) : undefined;
  const resizeMode = useMemo(() => resizeModeFromScale(scale), [scale]);

  return {
    state,
    source: state.source,
    sourceKey,
    engine,
    resizeMode,
    setEngineHandle,
    play,
    pause,
    toggle: useCallback(() => dispatch({ type: 'togglePause' }), []),
    seek,
    next,
    prev,
    selectEpisode: useCallback((episodeIndex: number, flagIndex?: number) => dispatch({ type: 'selectEpisode', episodeIndex, flagIndex }), []),
    switchFlag,
    setSpeed,
    selectTrack: useCallback((kind: 'audio' | 'text', id: TrackId | null) => dispatch({ type: 'selectTrack', kind, id }), []),
    addSubtitle: useCallback((subtitle: ExternalSubtitle) => dispatch({ type: 'addSubtitle', subtitle }), []),
    repeat,
    replay,
    stop,
    switchEngine,
    onEngineEvent,
  };
}
