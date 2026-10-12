import type { EngineError, EngineErrorReason, EngineKind, EngineSource } from './types';

/**
 * Engine choice and fallback policy. Defaults per platform: iOS / tvOS use
 * mpv, Android (phone and TV) uses the video engine (Media3). The
 * `playerEngine` setting's 'auto' means the platform default; 'video' / 'mpv'
 * are explicit choices. A fallback never changes the setting.
 */

export type EnginePreference = 'auto' | EngineKind;

/** Platform.OS; anything but 'ios' and 'android' behaves like Android. */
export type EnginePlatform = string;

export function otherEngine(kind: EngineKind): EngineKind {
  return kind === 'video' ? 'mpv' : 'video';
}

export function defaultEngine(platform: EnginePlatform): EngineKind {
  return platform === 'ios' ? 'mpv' : 'video';
}

/** Engine to start with; DRM sources go to the video engine up front. */
export function chooseEngine(
  preference: EnginePreference,
  platform: EnginePlatform,
  source?: Pick<EngineSource, 'drm'>,
): EngineKind {
  if (source?.drm) return 'video';
  return preference === 'auto' ? defaultEngine(platform) : preference;
}

export interface FallbackContext {
  /** The active engine reported `load` for the current source. */
  loaded: boolean;
  /** The one fallback of the current item has been used. */
  fallbackUsed: boolean;
  source?: Pick<EngineSource, 'drm'>;
}

/** Error reasons that switch engines, per platform and active engine. */
const IOS_MPV_REASONS: readonly EngineErrorReason[] = ['init', 'open', 'format', 'decoder', 'drm'];
const ANDROID_VIDEO_REASONS: readonly EngineErrorReason[] = ['init', 'format', 'decoder'];
const OTHER_REASONS: readonly EngineErrorReason[] = ['init'];

/**
 * Engine to retry the item on after `error`, or undefined to fail. Decided on
 * `reason` only (adapters report any pre-load error as phase 'init'):
 * - iOS on mpv -> video on init, open, format, decoder or DRM errors.
 * - Android on video -> mpv on init, format or decoder errors.
 * - Otherwise (an explicit choice of the other engine) -> on init errors only.
 * Network and other errors never switch engines. At most one fallback per
 * item. Availability is checked by the caller.
 */
export function fallbackDecision(
  platform: EnginePlatform,
  active: EngineKind,
  error: Pick<EngineError, 'phase' | 'reason'>,
  context: FallbackContext,
): EngineKind | undefined {
  if (context.fallbackUsed) return undefined;
  let reasons = OTHER_REASONS;
  if (platform === 'ios' && active === 'mpv') reasons = IOS_MPV_REASONS;
  else if (platform !== 'ios' && active === 'video') reasons = ANDROID_VIDEO_REASONS;
  return reasons.includes(error.reason) ? otherEngine(active) : undefined;
}
