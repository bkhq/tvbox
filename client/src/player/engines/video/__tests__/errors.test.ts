import type { EngineErrorReason } from '../../../engine/types';
import { avPlayerReason, media3NameReason, media3Reason, toEngineError } from '../errors';

describe('Media3 error codes', () => {
  it.each<[number, string, EngineErrorReason]>([
    [1000, 'ERROR_CODE_UNSPECIFIED', 'other'],
    [1002, 'ERROR_CODE_BEHIND_LIVE_WINDOW', 'other'],
    [1003, 'ERROR_CODE_TIMEOUT', 'network'],
    [2000, 'ERROR_CODE_IO_UNSPECIFIED', 'network'],
    [2001, 'ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', 'network'],
    [2004, 'ERROR_CODE_IO_BAD_HTTP_STATUS', 'network'],
    [2005, 'ERROR_CODE_IO_FILE_NOT_FOUND', 'network'],
    [3001, 'ERROR_CODE_PARSING_CONTAINER_MALFORMED', 'format'],
    [3003, 'ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED', 'format'],
    [3004, 'ERROR_CODE_PARSING_MANIFEST_UNSUPPORTED', 'format'],
    [4001, 'ERROR_CODE_DECODER_INIT_FAILED', 'decoder'],
    [4002, 'ERROR_CODE_DECODER_QUERY_FAILED', 'decoder'],
    [4003, 'ERROR_CODE_DECODING_FAILED', 'decoder'],
    [4004, 'ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES', 'format'],
    [4005, 'ERROR_CODE_DECODING_FORMAT_UNSUPPORTED', 'format'],
    [5001, 'ERROR_CODE_AUDIO_TRACK_INIT_FAILED', 'decoder'],
    [6000, 'ERROR_CODE_DRM_UNSPECIFIED', 'drm'],
    [6004, 'ERROR_CODE_DRM_LICENSE_ACQUISITION_FAILED', 'drm'],
  ])('%i %s -> %s', (code, name, reason) => {
    expect(media3Reason(code)).toBe(reason);
    expect(media3NameReason(name)).toBe(reason);
  });
});

describe('AVPlayer errors', () => {
  it.each<[string, number, EngineErrorReason]>([
    ['NSURLErrorDomain', -1009, 'network'],
    ['NSURLErrorDomain', -1001, 'network'],
    ['AVFoundationErrorDomain', -11828, 'format'],
    ['AVFoundationErrorDomain', -11829, 'format'],
    ['AVFoundationErrorDomain', -11821, 'decoder'],
    ['AVFoundationErrorDomain', -11833, 'decoder'],
    ['AVFoundationErrorDomain', -11835, 'drm'],
    ['AVFoundationErrorDomain', -11800, 'other'],
    ['CoreMediaErrorDomain', -12642, 'format'],
    ['CoreMediaErrorDomain', -12938, 'network'],
    ['CoreMediaErrorDomain', -1, 'other'],
    ['SomethingElse', 1, 'other'],
  ])('%s %i -> %s', (domain, code, reason) => {
    expect(avPlayerReason(domain, code)).toBe(reason);
  });
});

describe('toEngineError', () => {
  it('maps Android payloads, phase by first load', () => {
    const error = { errorString: 'ExoPlaybackException: ERROR_CODE_DECODING_FAILED', errorCode: '24003' };
    expect(toEngineError(error, false)).toEqual({
      code: '24003',
      message: 'ExoPlaybackException: ERROR_CODE_DECODING_FAILED',
      fatal: true,
      phase: 'init',
      reason: 'decoder',
    });
    expect(toEngineError(error, true)).toMatchObject({ phase: 'playback', reason: 'decoder' });
  });

  it('maps pre-load source and format errors to fatal init errors', () => {
    // Media3 reports an UnrecognizedInputFormatException as a source error with a parsing code.
    const unrecognized = {
      errorString: 'ExoPlaybackException: ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED',
      errorException: 'androidx.media3.exoplayer.ExoPlaybackException: Source error',
      errorCode: '23003',
    };
    expect(toEngineError(unrecognized, false)).toMatchObject({ fatal: true, phase: 'init', reason: 'format' });
    const io = { errorString: 'ExoPlaybackException: ERROR_CODE_IO_NETWORK_CONNECTION_FAILED', errorCode: '22001' };
    expect(toEngineError(io, false)).toMatchObject({ fatal: true, phase: 'init', reason: 'network' });
  });

  it('maps the library player-init and DRM-setup codes', () => {
    expect(toEngineError({ errorString: 'Failed to initialize Player!', errorCode: '1001' }, false)).toMatchObject({ reason: 'init' });
    expect(toEngineError({ errorString: 'onDrmSessionManagerError', errorCode: '3002' }, false)).toMatchObject({ reason: 'drm' });
  });

  it('falls back to the error code name in errorString', () => {
    expect(toEngineError({ errorString: 'ExoPlaybackException: ERROR_CODE_IO_BAD_HTTP_STATUS', errorCode: 'x' }, true)).toMatchObject({
      reason: 'network',
    });
  });

  it('maps iOS payloads', () => {
    expect(toEngineError({ domain: 'NSURLErrorDomain', code: -1009, localizedDescription: 'offline' }, true)).toEqual({
      code: 'NSURLErrorDomain:-1009',
      message: 'offline',
      fatal: true,
      phase: 'playback',
      reason: 'network',
    });
    expect(toEngineError({ error: 'asset failed' }, false)).toEqual({
      code: 'unknown',
      message: 'asset failed',
      fatal: true,
      phase: 'init',
      reason: 'other',
    });
  });
});
