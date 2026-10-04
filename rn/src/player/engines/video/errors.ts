import type { OnVideoErrorData } from 'react-native-video';

import type { EngineError, EngineErrorReason } from '../../engine/types';

/**
 * Classifies react-native-video errors for the fallback policy.
 *
 * Android (Media3) reports `errorCode` as "2" + PlaybackException.errorCode
 * (e.g. "22004" for ERROR_CODE_IO_BAD_HTTP_STATUS) and `errorString` as
 * "ExoPlaybackException: ERROR_CODE_*"; the library's own failures use
 * 4-digit codes ("1001" player init, "300x" DRM setup). iOS (AVPlayer)
 * reports an NSError `domain` and `code`.
 */

type VideoErrorPayload = OnVideoErrorData['error'];

/** Media3 PlaybackException error code -> reason, by code range. */
export function media3Reason(code: number): EngineErrorReason {
  if (code === 1003) return 'network'; // ERROR_CODE_TIMEOUT
  if (code >= 2000 && code < 3000) return 'network'; // ERROR_CODE_IO_*
  if (code >= 3000 && code < 4000) return 'format'; // ERROR_CODE_PARSING_*
  if (code === 4004 || code === 4005) return 'format'; // ERROR_CODE_DECODING_FORMAT_*
  if (code >= 4000 && code < 6000) return 'decoder'; // ERROR_CODE_DECODER_* / DECODING_* / AUDIO_TRACK_*
  if (code >= 6000 && code < 7000) return 'drm'; // ERROR_CODE_DRM_*
  return 'other';
}

/** Media3 error code name (PlaybackException.getErrorCodeName) -> reason. */
export function media3NameReason(name: string): EngineErrorReason {
  if (name.startsWith('ERROR_CODE_DRM_')) return 'drm';
  if (name.startsWith('ERROR_CODE_IO_') || name === 'ERROR_CODE_TIMEOUT') return 'network';
  if (name.startsWith('ERROR_CODE_PARSING_') || name.startsWith('ERROR_CODE_DECODING_FORMAT_')) return 'format';
  if (/^ERROR_CODE_(DECODER_|DECODING_|AUDIO_TRACK_)/.test(name)) return 'decoder';
  return 'other';
}

const AV_FORMAT = new Set([
  -11828, // AVErrorFileFormatNotRecognized
  -11829, // AVErrorFailedToParse
  -11838, // AVErrorOperationNotSupportedForAsset
  -11848, // AVErrorIncompatibleAsset
]);
const AV_DECODER = new Set([
  -11821, // AVErrorDecodeFailed
  -11833, // AVErrorDecoderNotFound
  -11839, // AVErrorDecoderTemporarilyUnavailable
]);
const AV_DRM = new Set([
  -11835, // AVErrorContentIsNotAuthorized
  -11836, // AVErrorApplicationIsNotAuthorized
]);
const CORE_MEDIA_HTTP = new Set([-12938, -12660, -12661]); // HTTP 404 / 403 / 401 while loading HLS

/** AVPlayer NSError domain and code -> reason. */
export function avPlayerReason(domain: string, code: number): EngineErrorReason {
  if (domain === 'NSURLErrorDomain') return 'network';
  if (domain === 'AVFoundationErrorDomain') {
    if (AV_FORMAT.has(code)) return 'format';
    if (AV_DECODER.has(code)) return 'decoder';
    if (AV_DRM.has(code)) return 'drm';
  }
  if (domain === 'CoreMediaErrorDomain') {
    if (code === -12642) return 'format'; // malformed playlist
    if (CORE_MEDIA_HTTP.has(code)) return 'network';
  }
  return 'other';
}

function androidReason(errorCode: string, errorString: string): EngineErrorReason {
  if (errorCode === '1001') return 'init';
  if (/^300\d$/.test(errorCode)) return 'drm';
  if (/^2\d{4}$/.test(errorCode)) return media3Reason(Number(errorCode.slice(1)));
  const name = /ERROR_CODE_[A-Z0-9_]+/.exec(errorString)?.[0];
  return name ? media3NameReason(name) : 'other';
}

/** Maps an onError payload to an engine error; errors before the first load are phase 'init'. */
export function toEngineError(error: VideoErrorPayload, loaded: boolean): EngineError {
  const phase = loaded ? 'playback' : 'init';
  const message = error.errorString ?? error.localizedDescription ?? error.error ?? 'unknown error';
  if (error.errorCode !== undefined) {
    return { code: error.errorCode, message, fatal: true, phase, reason: androidReason(error.errorCode, message) };
  }
  if (error.domain) {
    const code = error.code ?? 0;
    return { code: `${error.domain}:${code}`, message, fatal: true, phase, reason: avPlayerReason(error.domain, code) };
  }
  return { code: error.code ?? 'unknown', message, fatal: true, phase, reason: 'other' };
}
