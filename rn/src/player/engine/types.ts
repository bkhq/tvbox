import type { ComponentType, RefAttributes } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * Engine contract. Engines are React components (react-native-video is one);
 * the playback state lives outside them and they report back through
 * `onEvent`. Mirrors player/engine/PlayerEngine.java.
 */

export type EngineKind = 'video' | 'mpv';

export interface ExternalSubtitle {
  url: string;
  name: string;
  lang?: string;
  /** MIME type, e.g. "text/vtt" or "application/x-subrip". */
  format?: string;
}

export interface EngineSource {
  url: string;
  headers: Record<string, string>;
  title?: string;
  /** Milliseconds to start from; undefined starts at 0. */
  startPosition?: number;
  /** MIME hint (Result.format), e.g. "application/x-mpegURL". */
  format?: string;
  subtitles: ExternalSubtitle[];
  /** DRM scheme of the source; nothing sets it in v1. DRM sources play on the video engine. */
  drm?: { type: string; licenseUrl?: string; headers?: Record<string, string> };
}

export type ResizeMode = 'contain' | 'cover' | 'stretch' | 'fill';

export type TrackId = string | number;

export interface Track {
  id: TrackId;
  label: string;
  language?: string;
  selected?: boolean;
}

export interface EngineTracks {
  audio: Track[];
  text: Track[];
  video: Track[];
}

export type EngineErrorPhase = 'init' | 'playback';

/** Error classification reported by engine adapters; drives the fallback policy. */
export type EngineErrorReason = 'init' | 'open' | 'format' | 'decoder' | 'drm' | 'network' | 'other';

export interface EngineError {
  code: string | number;
  message: string;
  fatal: boolean;
  phase: EngineErrorPhase;
  reason: EngineErrorReason;
}

export type EngineEvent =
  | { type: 'load'; duration: number; tracks: EngineTracks }
  | { type: 'progress'; position: number; duration: number; buffered: number }
  | { type: 'buffering'; value: boolean }
  | { type: 'playing' }
  | { type: 'paused' }
  | { type: 'ended' }
  | ({ type: 'tracks' } & EngineTracks)
  | ({ type: 'error' } & EngineError);

export interface EngineViewProps {
  source: EngineSource;
  paused: boolean;
  rate: number;
  resizeMode: ResizeMode;
  selectedAudioTrack?: TrackId;
  /** Text track id; null turns subtitles off, undefined leaves the engine default. */
  selectedTextTrack?: TrackId | null;
  style?: StyleProp<ViewStyle>;
  onEvent(event: EngineEvent): void;
}

export interface EngineHandle {
  /** Milliseconds. */
  seek(ms: number): void;
  release?(): void;
}

export interface EngineFactory {
  kind: EngineKind;
  /** Chinese UI name, e.g. "系统播放器" or "MPV". */
  label: string;
  isAvailable(): boolean;
  Component: ComponentType<EngineViewProps & RefAttributes<EngineHandle>>;
}

/**
 * The integer `scale` setting (select_scale: 原始, 16:9, 4:3, 填充, 裁剪) as a
 * resize mode. Fixed aspect ratios have no resize-mode equivalent and keep
 * the original ratio.
 */
export function resizeModeFromScale(scale: number): ResizeMode {
  if (scale === 3) return 'stretch';
  if (scale === 4) return 'cover';
  return 'contain';
}
