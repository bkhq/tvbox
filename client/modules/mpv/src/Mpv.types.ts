import type { ViewProps } from 'react-native';

/**
 * Native contract of the mpv view, shared by Android (MpvView.kt) and iOS / tvOS
 * (MpvView.swift). Times are seconds, as mpv reports them.
 */

export interface MpvNativeSubtitle {
  url: string;
  name: string;
  lang?: string;
}

export interface MpvNativeSource {
  url: string;
  headers: Record<string, string>;
  title?: string;
  /** Seconds; 0 starts at the beginning. */
  startPosition: number;
  format?: string;
  subtitles: MpvNativeSubtitle[];
}

export interface MpvNativeTrack {
  id: number;
  /** mpv track type: 'video' | 'audio' | 'sub'. */
  type: string;
  title?: string | null;
  lang?: string | null;
  codec?: string | null;
  selected: boolean;
  external: boolean;
}

export type MpvNativeEvent =
  | { type: 'loaded'; duration: number; tracks: MpvNativeTrack[] }
  | { type: 'progress'; position: number; duration: number; buffered: number }
  | { type: 'pause'; value: boolean }
  | { type: 'buffering'; value: boolean }
  | { type: 'tracks'; tracks: MpvNativeTrack[] }
  /** mpv end-file with reason EOF (0) or ERROR (4); `code` is the mpv error code, `log` the last warning. */
  | { type: 'endFile'; reason: number; code: number; message: string; log?: string | null }
  /** Library load, mpv_create or mpv_initialize failed. */
  | { type: 'error'; phase: 'init'; code: string; message: string };

export interface MpvViewProps extends ViewProps {
  source: MpvNativeSource;
  paused: boolean;
  speed: number;
  /** mpv `aid`: 'auto', 'no' or a track id. */
  audioTrack: string;
  /** mpv `sid`: 'auto', 'no' or a track id. */
  subtitleTrack: string;
  resizeMode: 'contain' | 'cover' | 'stretch' | 'fill';
  /** The `decode` setting: hardware (mediacodec / videotoolbox) or software decoding. */
  decode: 'hard' | 'soft';
  onMpvEvent?: (event: { nativeEvent: MpvNativeEvent }) => void;
}

/** Methods on the native view's ref. */
export interface MpvViewHandle {
  /** Milliseconds. */
  seek(ms: number): Promise<void>;
}
