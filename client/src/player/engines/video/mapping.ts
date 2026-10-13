import {
  type OnLoadData,
  type ReactVideoSource,
  type SelectedTrack,
  SelectedTrackType,
  type SubtitleStyle,
  TextTrackType,
  type TextTracks,
} from 'react-native-video';

import type { Scaler } from '../../../ui';
import type { EngineSource, ExternalSubtitle, ResizeMode, Track, TrackId } from '../../engine/types';

/** EngineViewProps -> react-native-video props. Times on the video side are seconds except startPosition (ms). */

const SUBTITLE_MIMES: readonly string[] = Object.values(TextTrackType);
const SUBTITLE_EXTENSIONS: Record<string, TextTrackType> = {
  srt: TextTrackType.SUBRIP,
  vtt: TextTrackType.VTT,
  ttml: TextTrackType.TTML,
  dfxp: TextTrackType.TTML,
  xml: TextTrackType.TTML,
};

/** MIME of an external subtitle, or undefined when the video engine cannot render it (e.g. ASS). */
export function subtitleMime(subtitle: ExternalSubtitle): TextTrackType | undefined {
  if (subtitle.format && SUBTITLE_MIMES.includes(subtitle.format)) return subtitle.format as TextTrackType;
  const extension = /\.([a-z0-9]+)(?:[?#]|$)/i.exec(subtitle.url)?.[1]?.toLowerCase();
  return extension ? SUBTITLE_EXTENSIONS[extension] : undefined;
}

export function toTextTracks(subtitles: ExternalSubtitle[]): TextTracks {
  const tracks: TextTracks = [];
  for (const subtitle of subtitles) {
    const type = subtitleMime(subtitle);
    if (!type) continue;
    // The library types language as ISO 639-1; anything it does not know is passed through unchanged.
    tracks.push({ title: subtitle.name, language: (subtitle.lang ?? '') as TextTracks[number]['language'], type, uri: subtitle.url });
  }
  return tracks;
}

/** Subtitle box of the 1080p player design: 36px text sitting 300px above the bottom edge, clear of the OSD. */
export const SUBTITLE_DESIGN = { fontSize: 36, minFontSize: 20, bottom: 300 } as const;
// ExoPlayer's SubtitleView already lifts cues by 8% of its height, so the padding only adds the rest.
const EXO_BOTTOM_FRACTION = 0.08;

/**
 * react-native-video `subtitleStyle` for the design box. fontSize is in sp (~dp); the paddings are raw
 * pixels on Android, hence `pixelRatio`. The library cannot draw a background box.
 */
export function toSubtitleStyle(s: Scaler, subtitleScale: number, pixelRatio: number): SubtitleStyle {
  const fontSize = Math.max(SUBTITLE_DESIGN.minFontSize, SUBTITLE_DESIGN.fontSize * subtitleScale);
  const bottom = Math.round(SUBTITLE_DESIGN.bottom - 1080 * EXO_BOTTOM_FRACTION);
  return { fontSize: Math.round(s(fontSize)), paddingBottom: Math.round(s(bottom) * pixelRatio), opacity: 1 };
}

/** react-native-video `type` override from the Result.format MIME hint. */
export function sourceType(format?: string): string | undefined {
  const mime = format?.toLowerCase();
  if (!mime) return undefined;
  if (mime.includes('mpegurl')) return 'm3u8';
  if (mime.includes('dash')) return 'mpd';
  if (mime.includes('ms-sstr')) return 'ism';
  return undefined;
}

export function toVideoSource(source: EngineSource): ReactVideoSource {
  const textTracks = toTextTracks(source.subtitles);
  return {
    uri: source.url,
    headers: source.headers,
    ...(source.startPosition ? { startPosition: source.startPosition } : {}),
    ...(sourceType(source.format) ? { type: sourceType(source.format) } : {}),
    ...(textTracks.length > 0 ? { textTracks } : {}),
    ...(source.title ? { metadata: { title: source.title } } : {}),
  };
}

export function toVideoResizeMode(mode: ResizeMode): 'contain' | 'cover' | 'stretch' {
  return mode === 'fill' ? 'stretch' : mode;
}

/** Undefined leaves the engine default; null turns the track off. */
export function toSelectedTrack(id: TrackId | null | undefined): SelectedTrack | undefined {
  if (id === undefined) return undefined;
  if (id === null) return { type: SelectedTrackType.DISABLED };
  return { type: SelectedTrackType.INDEX, value: id };
}

interface NativeTrack {
  index: number;
  title?: string;
  language?: string;
  selected?: boolean;
}

function toTrack(track: NativeTrack, label: string): Track {
  return {
    id: track.index,
    label,
    ...(track.language ? { language: track.language } : {}),
    ...(track.selected !== undefined ? { selected: track.selected } : {}),
  };
}

export function toAudioTracks(tracks: readonly NativeTrack[] = []): Track[] {
  return tracks.map((t, i) => toTrack(t, t.title || t.language || `音轨 ${i + 1}`));
}

export function toTextTrackList(tracks: readonly NativeTrack[] = []): Track[] {
  return tracks.map((t, i) => toTrack(t, t.title || t.language || `字幕 ${i + 1}`));
}

export function toVideoTracks(tracks: OnLoadData['videoTracks'] = []): Track[] {
  return tracks.map((t, i) =>
    toTrack({ index: t.index, selected: t.selected }, t.width && t.height ? `${t.width}x${t.height}` : `视频 ${i + 1}`),
  );
}

/** Video pixel size from onLoad `naturalSize`, upright for portrait videos; undefined unless both sides are > 0. */
export function toVideoSize(size: OnLoadData['naturalSize'] | undefined): { width: number; height: number } | undefined {
  if (!size || !(size.width > 0) || !(size.height > 0)) return undefined;
  const swap = size.orientation === 'portrait' && size.width > size.height;
  return swap ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}
