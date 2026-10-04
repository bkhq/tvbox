import type { EngineError, EngineKind, EngineSource } from './types';

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

/**
 * Engine to retry the item on after `error`, or undefined to fail:
 * - iOS on mpv -> video when mpv cannot init or open the item (init / open
 *   errors, any error before the first load) or the source needs DRM.
 * - Android on video -> mpv on init failure or unsupported format / decoder errors;
 *   network and other source errors do not switch engines.
 * - Otherwise -> the other engine on init failure only.
 * At most one fallback per item. Availability is checked by the caller.
 */
export function fallbackDecision(
  platform: EnginePlatform,
  active: EngineKind,
  error: Pick<EngineError, 'phase' | 'reason'>,
  context: FallbackContext,
): EngineKind | undefined {
  if (context.fallbackUsed) return undefined;
  const init = error.phase === 'init' || error.reason === 'init';
  const other = otherEngine(active);
  if (platform === 'ios' && active === 'mpv') {
    const cannotOpen = error.reason === 'open' || !context.loaded;
    return init || cannotOpen || error.reason === 'drm' || !!context.source?.drm ? other : undefined;
  }
  if (platform !== 'ios' && active === 'video') {
    return init || error.reason === 'format' || error.reason === 'decoder' ? other : undefined;
  }
  return init ? other : undefined;
}
