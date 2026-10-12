/**
 * App-wide playback control for LAN services (phone control page, DLNA,
 * AirPlay casts); server/PlayerCommand.java is the reference command set.
 * The screen that owns playback (Player, later Live) attaches as the host;
 * without a host the state is inactive and controls are no-ops. playUrl goes
 * through the registered opener (navigation to Player) and is delivered to
 * the next host that accepts URLs.
 */

import { parseSetting } from '../core/settings/schema';
import type { EngineKind } from './engine/types';
import type { PlaybackStatus } from './machine';

export interface PlaybackSnapshot {
  active: boolean;
  playing: boolean;
  title: string;
  /** Milliseconds. */
  position: number;
  /** Milliseconds. */
  duration: number;
  speed: number;
  repeat: boolean;
  url?: string;
  engine?: EngineKind;
  status: PlaybackStatus;
}

export interface PlayUrlOptions {
  title?: string;
  /** Start position in milliseconds. */
  position?: number;
  headers?: Record<string, string>;
}

/** Direct-URL Player route params. */
export interface PlayUrlRequest extends PlayUrlOptions {
  url: string;
}

export type SnapshotListener = (snapshot: PlaybackSnapshot) => void;

export interface PlaybackCommands {
  play(): void;
  pause(): void;
  stop(): void;
  /** VOD: episode; Live: channel. */
  prev(): void;
  next(): void;
  /** Toggles repeat-one of the current item. */
  repeat(): void;
  /** Restarts the current item from 0. */
  replay(): void;
  seekTo(ms: number): void;
  setSpeed(speed: number): void;
}

export interface PlaybackController extends PlaybackCommands {
  getState(): PlaybackSnapshot;
  playUrl(url: string, opts?: PlayUrlOptions): void;
  subscribe(listener: SnapshotListener): () => void;
}

export interface PlaybackHost extends PlaybackCommands {
  getState(): PlaybackSnapshot;
  /** State push: the host calls `push` whenever its snapshot changes. */
  subscribe(push: SnapshotListener): () => void;
  /** Plays a direct URL in place; hosts without it (Live) get the request through the opener. */
  playUrl?(request: PlayUrlRequest): void;
}

export type PlayerOpener = (request: PlayUrlRequest) => void;

export const INACTIVE_SNAPSHOT: PlaybackSnapshot = Object.freeze({
  active: false,
  playing: false,
  title: '',
  position: 0,
  duration: 0,
  speed: 1,
  repeat: false,
  status: 'idle',
});

export interface PlaybackControllerHub {
  controller: PlaybackController;
  attachPlaybackHost(host: PlaybackHost): () => void;
  setPlayerOpener(opener: PlayerOpener | undefined): void;
}

/** speedPlayback range (SpeedSetting.MIN..MAX). */
function clampSpeed(speed: number): number | undefined {
  return parseSetting('speedPlayback', speed);
}

export function createPlaybackControllerHub(): PlaybackControllerHub {
  const listeners = new Set<SnapshotListener>();
  let host: PlaybackHost | undefined;
  let unsubscribeHost: (() => void) | undefined;
  let opener: PlayerOpener | undefined;
  let pending: PlayUrlRequest | undefined;
  let snapshot: PlaybackSnapshot = INACTIVE_SNAPSHOT;

  const emit = (next: PlaybackSnapshot) => {
    snapshot = next;
    for (const listener of [...listeners]) listener(next);
  };

  const deliver = () => {
    if (!pending) return;
    if (host?.playUrl) {
      const request = pending;
      pending = undefined;
      host.playUrl(request);
    } else if (opener) {
      opener(pending);
    }
  };

  const command =
    <K extends keyof PlaybackCommands>(name: K) =>
    (...args: Parameters<PlaybackCommands[K]>) => {
      if (!host) return;
      (host[name] as (...a: Parameters<PlaybackCommands[K]>) => void)(...args);
    };

  const controller: PlaybackController = {
    getState: () => snapshot,
    play: command('play'),
    pause: command('pause'),
    stop: command('stop'),
    prev: command('prev'),
    next: command('next'),
    repeat: command('repeat'),
    replay: command('replay'),
    seekTo: (ms) => {
      if (Number.isFinite(ms)) host?.seekTo(Math.max(0, ms));
    },
    setSpeed: (speed) => {
      const value = clampSpeed(speed);
      if (value !== undefined) host?.setSpeed(value);
    },
    playUrl(url, opts = {}) {
      pending = { url, ...opts };
      deliver();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return {
    controller,
    attachPlaybackHost(next) {
      unsubscribeHost?.();
      host = next;
      unsubscribeHost = next.subscribe(emit);
      emit(next.getState());
      deliver();
      return () => {
        if (host !== next) return;
        unsubscribeHost?.();
        unsubscribeHost = undefined;
        host = undefined;
        emit(INACTIVE_SNAPSHOT);
      };
    },
    setPlayerOpener(next) {
      opener = next;
      if (pending && !host?.playUrl) deliver();
    },
  };
}

const shared = createPlaybackControllerHub();

export function getPlaybackController(): PlaybackController {
  return shared.controller;
}

/** Attaches the screen that owns playback; returns the detach function. */
export function attachPlaybackHost(host: PlaybackHost): () => void {
  return shared.attachPlaybackHost(host);
}

/** Registers how to open the Player screen for a direct URL (navigation). */
export function setPlayerOpener(opener: PlayerOpener | undefined): void {
  shared.setPlayerOpener(opener);
}
