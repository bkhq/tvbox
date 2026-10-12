import type {
  MpvNativeEvent,
  MpvNativeTrack,
  MpvViewProps,
} from '../../../../modules/mpv';
import type {
  EngineErrorReason,
  EngineEvent,
  EngineTracks,
  EngineViewProps,
  Track,
  TrackId,
} from '../../engine/types';

/** mpv_end_file_reason values the native views report. */
export const MPV_END_FILE_EOF = 0;
export const MPV_END_FILE_ERROR = 4;

/** mpv_error codes (client.h) used for classification. */
export const MpvError = {
  LOADING_FAILED: -13,
  AO_INIT_FAILED: -14,
  VO_INIT_FAILED: -15,
  NOTHING_TO_PLAY: -16,
  UNKNOWN_FORMAT: -17,
} as const;

export type MpvDecode = MpvViewProps['decode'];

type NativeProps = Omit<MpvViewProps, 'onMpvEvent' | 'style'>;

/** mpv `aid` / `sid` value: undefined keeps mpv's choice, null turns the track off. */
export function trackSelection(id: TrackId | null | undefined): string {
  if (id === undefined) return 'auto';
  if (id === null) return 'no';
  return String(id);
}

export function toNativeProps(props: Omit<EngineViewProps, 'onEvent' | 'style'>, decode: MpvDecode): NativeProps {
  const { source } = props;
  return {
    source: {
      url: source.url,
      headers: source.headers,
      title: source.title,
      startPosition: source.startPosition ? source.startPosition / 1000 : 0,
      format: source.format,
      subtitles: source.subtitles.map(({ url, name, lang }) => ({ url, name, lang })),
    },
    paused: props.paused,
    speed: props.rate,
    audioTrack: trackSelection(props.selectedAudioTrack),
    subtitleTrack: trackSelection(props.selectedTextTrack),
    resizeMode: props.resizeMode,
    decode,
  };
}

const TRACK_KINDS: Record<string, { key: keyof EngineTracks; label: string }> = {
  audio: { key: 'audio', label: '音轨' },
  sub: { key: 'text', label: '字幕' },
  video: { key: 'video', label: '视频' },
};

export function toTracks(tracks: MpvNativeTrack[]): EngineTracks {
  const result: EngineTracks = { audio: [], text: [], video: [] };
  for (const track of tracks) {
    const kind = TRACK_KINDS[track.type];
    if (!kind) continue;
    const mapped: Track = {
      id: track.id,
      label: track.title || track.lang || `${kind.label} ${track.id}`,
      selected: track.selected,
    };
    if (track.lang) mapped.language = track.lang;
    result[kind.key].push(mapped);
  }
  return result;
}

const NETWORK_LOG = /\b(https?|tcp|tls|ssl|connection|connect|timed out|timeout|network|resolve|dns|40\d|50\d)\b/i;
const FORMAT_TEXT = /(unrecognized|failed to recognize) (file )?format|unknown format|no (audio or video|streams)/i;
const NETWORK_SCHEMES = /^(https?|rtmp|rtsp|rtspt|ftp):/i;

/**
 * Classifies an mpv end-file error: unrecognized formats -> 'format', audio / video
 * output init failures -> 'decoder', network or HTTP failures (from mpv's last warning
 * log line) -> 'network', anything else before the first load -> 'open', later errors on
 * a network URL -> 'network', otherwise 'other'.
 */
export function classifyMpvError(
  error: { code: number; message: string; log?: string | null },
  context: { loaded: boolean; url: string },
): EngineErrorReason {
  if (error.code === MpvError.UNKNOWN_FORMAT || error.code === MpvError.NOTHING_TO_PLAY) return 'format';
  if (error.code === MpvError.AO_INIT_FAILED || error.code === MpvError.VO_INIT_FAILED) return 'decoder';
  const log = error.log ?? '';
  if (FORMAT_TEXT.test(`${error.message} ${log}`)) return 'format';
  if (NETWORK_LOG.test(log)) return 'network';
  if (!context.loaded) return 'open';
  return NETWORK_SCHEMES.test(context.url) ? 'network' : 'other';
}

const sToMs = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

/**
 * Stateful mapper from native mpv events to engine events for one source. Pause and
 * buffering changes are only forwarded after `load`, as mpv reports initial values while
 * the file is still opening.
 */
export function createMpvEventMapper(url: string): (event: MpvNativeEvent) => EngineEvent[] {
  let loaded = false;
  let paused: boolean | undefined;
  return (event) => {
    switch (event.type) {
      case 'error':
        return [{ type: 'error', code: event.code, message: event.message, fatal: true, phase: 'init', reason: 'init' }];
      case 'loaded':
        loaded = true;
        return [{ type: 'load', duration: sToMs(event.duration), tracks: toTracks(event.tracks) }];
      case 'progress':
        return loaded
          ? [{ type: 'progress', position: sToMs(event.position), duration: sToMs(event.duration), buffered: sToMs(event.buffered) }]
          : [];
      case 'pause':
        if (!loaded || paused === event.value) return [];
        paused = event.value;
        return [{ type: event.value ? 'paused' : 'playing' }];
      case 'buffering':
        return loaded ? [{ type: 'buffering', value: event.value }] : [];
      case 'tracks':
        return loaded ? [{ type: 'tracks', ...toTracks(event.tracks) }] : [];
      case 'endFile':
        if (event.reason === MPV_END_FILE_EOF) return [{ type: 'ended' }];
        if (event.reason !== MPV_END_FILE_ERROR) return [];
        return [
          {
            type: 'error',
            code: event.code,
            message: [event.message || 'mpv error', event.log].filter(Boolean).join(': '),
            fatal: true,
            phase: 'playback',
            reason: classifyMpvError(event, { loaded, url }),
          },
        ];
    }
  };
}
