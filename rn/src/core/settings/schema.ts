/**
 * Typed settings mirroring the Java app's Prefers keys under
 * app/src/main/java/com/fongmi/android/tv/setting. Danmaku and Android-UI-only
 * keys (wallpaper, theme colour, keyboard) are left out.
 *
 * Validation follows the Java putters: numeric ranges are clamped with
 * Math.clamp semantics; values of the wrong type, non-finite numbers and
 * unknown enum members are rejected (parse returns undefined).
 */

export interface SettingSpec<T> {
  default: T;
  parse(value: unknown): T | undefined;
}

function boolean(defaultValue: boolean): SettingSpec<boolean> {
  return { default: defaultValue, parse: (value) => (typeof value === 'boolean' ? value : undefined) };
}

function text(defaultValue = ''): SettingSpec<string> {
  return { default: defaultValue, parse: (value) => (typeof value === 'string' ? value : undefined) };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Float in [min, max]. */
function decimal(defaultValue: number, min: number, max: number): SettingSpec<number> {
  return {
    default: defaultValue,
    parse: (value) => (typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : undefined),
  };
}

/** Integer in [min, max], optionally snapped to `step` from min (PreloadSetting). */
function integer(defaultValue: number, min: number, max: number, step = 1): SettingSpec<number> {
  return {
    default: defaultValue,
    parse: (value) => {
      if (typeof value !== 'number' || !Number.isInteger(value)) return undefined;
      const clamped = clamp(value, min, max);
      return clamp(min + Math.round((clamped - min) / step) * step, min, max);
    },
  };
}

/** 32-bit ARGB colour stored unsigned (0xAARRGGBB). */
function color(defaultValue: number): SettingSpec<number> {
  return {
    default: defaultValue,
    parse: (value) =>
      typeof value === 'number' && Number.isInteger(value) && value >= -0x80000000 && value <= 0xffffffff
        ? value >>> 0
        : undefined,
  };
}

function choice<const T extends string>(values: readonly T[], defaultValue: NoInfer<T>): SettingSpec<T> {
  return {
    default: defaultValue,
    parse: (value) => (values.includes(value as T) ? (value as T) : undefined),
  };
}

/** SpeedSetting.PRESETS: speeds offered in the speed picker. */
export const SPEED_PRESETS: readonly number[] = [0.1, 0.5, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 5.0];

export const settingsSchema = {
  // --- Setting.java
  doh: text(), // "doh"
  ua: text(), // "ua"
  siteMode: integer(0, 0, 1), // "site_mode"
  airplay: boolean(true), // "airplay"
  airplayName: text(), // "airplay_name"
  incognito: boolean(false), // "incognito"
  adblock: boolean(true), // "adblock"
  homeSiteKey: text(), // Config.home (home site key of the active VOD config)

  // --- PlayerSetting.java
  playerEngine: choice(['video', 'mpv'], 'video'), // "player_engine" (0 = ExoPlayer, 1 = mpv)
  playerDebug: boolean(false), // "player_debug"
  mpvGpuNext: boolean(false), // "mpv_gpu_next"
  mpvVulkan: boolean(false), // "mpv_vulkan"
  render: choice(['surface', 'texture'], 'surface'), // "render"
  scale: integer(0, 0, 4), // "scale"
  background: boolean(true), // "background" (0 = off, 1 = on)
  buffer: integer(1, 1, 10), // "buffer"
  decode: choice(['hard', 'soft'], 'hard'), // "decode" (legacy Players.HARD / SOFT)

  // --- DecodeSetting.java
  audioPassThrough: boolean(true), // "decode_audio_pass_through"
  audioPrefer: boolean(false), // "decode_audio_prefer"
  videoPrefer: boolean(false), // "decode_video_prefer"
  preferAac: boolean(false), // "decode_prefer_aac"
  tunnel: boolean(false), // "decode_tunnel"

  // --- SpeedSetting.java
  speedPlayback: decimal(1.0, 0.1, 5.0), // "speed_playback"
  speedLongPress: decimal(2.0, 2.0, 5.0), // "speed_long_press"
  speedSkipSilence: boolean(false), // "speed_skip_silence"

  // --- SubtitleSetting.java
  subtitleSearchToken: text(), // "subtitle_search_token"
  subtitleStyleSource: choice(['original', 'system', 'custom'], 'original'), // "subtitle_style_source"
  subtitleScale: decimal(1.0, 0.5, 2.0), // "subtitle_scale"
  subtitlePosition: decimal(0, -20, 30), // "subtitle_position"
  subtitleForegroundColor: color(0xffffffff), // "subtitle_foreground_color"
  subtitleForegroundOpacity: decimal(1, 0, 1), // "subtitle_foreground_opacity"
  subtitleBackgroundColor: color(0x00000000), // "subtitle_background_color"
  subtitleBackgroundOpacity: decimal(1, 0, 1), // "subtitle_background_opacity"
  subtitleEdgeType: choice(['none', 'outline', 'dropShadow'], 'outline'), // "subtitle_edge_type"
  subtitleEdgeColor: color(0xff000000), // "subtitle_edge_color"
  subtitleEdgeOpacity: decimal(1, 0, 1), // "subtitle_edge_opacity"
  subtitleEdgeWidth: decimal(2, 0, 6), // "subtitle_edge_width"
  subtitleShadow: decimal(2, 0, 8), // "subtitle_shadow"
  subtitleSecondaryTrack: integer(-2, -2, Number.MAX_SAFE_INTEGER), // "subtitle_secondary_track" (-2 off, -1 auto)
  subtitleSecondaryPosition: decimal(10, 0, 150), // "subtitle_secondary_position"

  // --- LiveSetting.java
  bootLive: boolean(false), // "boot_live"
  across: boolean(true), // "across"
  change: boolean(true), // "change"
  invert: boolean(false), // "invert"
  scaleLive: integer(0, 0, 4), // "scale_live"

  // --- VideoSetting.java
  videoEnabled: boolean(false), // "video_enabled"
  videoPreset: integer(1, 1, 13), // "video_preset" (VideoEffectPreset NATURAL..CUSTOM)
  videoSaturation: decimal(1, 0.5, 2), // "video_saturation"
  videoContrast: decimal(1, 0.5, 1.8), // "video_contrast"
  videoBrightness: decimal(0, -0.2, 0.2), // "video_brightness"
  videoSharpness: decimal(0, 0, 0.8), // "video_sharpness"
  videoShadow: decimal(0, 0, 0.6), // "video_shadow"
  videoGamma: decimal(1, 0.5, 2), // "video_gamma"
  videoHue: decimal(0, -180, 180), // "video_hue"
  videoTemperature: decimal(0, -100, 100), // "video_temperature"

  // --- AudioSetting.java
  audioEnabled: boolean(false), // "audio_enabled"
  audioPreset: integer(1, 1, 13), // "audio_preset" (AudioEffectPreset NATURAL..CUSTOM)
  audioStability: integer(0, 0, 100), // "audio_stability"
  audioDialogue: integer(0, 0, 100), // "audio_dialogue"
  audioBoost: integer(0, 0, 1200), // "audio_boost"
  audioPreamp: integer(0, -1200, 0), // "audio_preamp"
  audioLoudness: boolean(false), // "audio_loudness"
  audioCenterGain: integer(0, 0, 1200), // "audio_center_gain"
  audioBalance: integer(0, -100, 100), // "audio_balance"
  audioChannelMode: choice(['auto', 'stereo', 'mono', 'reverse'], 'auto'), // "audio_channel_mode"

  // --- PreloadSetting.java
  preload: boolean(false), // "preload"
  preloadNextEpisode: boolean(false), // "preload_next_episode"
  preloadThreads: integer(1, 1, 10), // "preload_threads"
  preloadSize: integer(128, 128, 4096, 128), // "preload_size" (MB)
  preloadTime: integer(120, 20, 120, 10), // "preload_time" (seconds)
};

type Schema = typeof settingsSchema;

export type SettingKey = keyof Schema;

export type Settings = { [K in SettingKey]: Schema[K] extends SettingSpec<infer T> ? T : never };

export const SETTING_KEYS = Object.keys(settingsSchema) as SettingKey[];

export function defaultSettings(): Settings {
  const result: Partial<Record<SettingKey, unknown>> = {};
  for (const key of SETTING_KEYS) result[key] = settingsSchema[key].default;
  return result as Settings;
}

/** Validated value for `key`, or undefined when `value` is invalid. */
export function parseSetting<K extends SettingKey>(key: K, value: unknown): Settings[K] | undefined {
  return (settingsSchema[key] as SettingSpec<Settings[K]>).parse(value);
}
