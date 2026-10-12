import type { LegacyPref, LegacyPrefs, LegacyRow } from '../../../modules/migrate/src/Migrate.types';
import { parseSetting, type SettingKey, type Settings } from '../settings/schema';
import type { History, Keep } from '../types';

/**
 * Pure mapping of the Java app's data (SharedPreferences + Room rows) to the
 * shapes the RN stores persist. No I/O and no React Native imports.
 */

/** AppDatabase.SYMBOL */
const SYMBOL = '@@@';
/** Stand-in for C.TIME_UNSET, as in storage/history.ts. */
const TIME_UNSET = -1;

type JavaType = 'string' | 'boolean' | 'int' | 'float';

function pref(prefs: LegacyPrefs, key: string, type: JavaType): unknown {
  const entry: LegacyPref | undefined = prefs[key];
  return entry?.type === type ? entry.value : undefined;
}

// ---------------------------------------------------------------------------
// Server link and device id

/** serverLink.ts Persisted, stored under SERVER_LINK_KEY. */
export interface ServerLinkData {
  enabled: boolean;
  code: string;
  subscription: string;
  deviceKey: string;
}

/** Enroll.java prefs: enroll, enroll_code, enroll_subscription, enroll_device_key. */
export function mapServerLink(prefs: LegacyPrefs): ServerLinkData | undefined {
  const data: ServerLinkData = {
    enabled: pref(prefs, 'enroll', 'boolean') === true,
    code: String(pref(prefs, 'enroll_code', 'string') ?? ''),
    subscription: String(pref(prefs, 'enroll_subscription', 'string') ?? ''),
    deviceKey: String(pref(prefs, 'enroll_device_key', 'string') ?? ''),
  };
  return data.enabled || data.code || data.subscription || data.deviceKey ? data : undefined;
}

/** DeviceId.java keeps a random MAC under "airplay_device_id" (not ANDROID_ID). */
export function mapDeviceId(prefs: LegacyPrefs): string | undefined {
  const id = pref(prefs, 'airplay_device_id', 'string');
  return typeof id === 'string' && id !== '' ? id : undefined;
}

// ---------------------------------------------------------------------------
// Settings

interface SettingRule {
  java: string;
  type: JavaType;
  /** Older key PlayerSetting/DecodeSetting/SpeedSetting fall back to, same type. */
  legacy?: string;
  /** Java value -> RN value; identity when omitted. */
  map?: (value: never) => unknown;
}

const enumOf =
  <T>(values: readonly T[]) =>
  (value: number): T | undefined =>
    values[value];

/**
 * Java pref -> RN setting. Every value still goes through the schema's parse(),
 * so out-of-range numbers are clamped and unknown enum members skipped.
 *
 * | RN setting                | Java key (type)                                   | mapping                         |
 * | ------------------------- | ------------------------------------------------- | ------------------------------- |
 * | doh, ua, airplayName      | doh, ua, airplay_name (string)                    | as is                           |
 * | subtitleSearchToken       | subtitle_search_token (string)                    | as is                           |
 * | siteMode, scale, buffer   | site_mode, scale, buffer (int)                    | as is                           |
 * | scaleLive                 | scale_live (int)                                  | as is                           |
 * | airplay, incognito, ...   | same-named boolean keys (see SETTING_RULES)       | as is                           |
 * | audioPassThrough          | decode_audio_pass_through, else audio_pass_through| as is                           |
 * | audioPrefer / videoPrefer | decode_{audio,video}_prefer, else {audio,video}_prefer | as is                      |
 * | preferAac / tunnel        | decode_prefer_aac / decode_tunnel, else prefer_aac / tunnel | as is                 |
 * | playerEngine              | player_engine (int)                               | 0 -> video, 1 -> mpv            |
 * | render                    | render (int)                                      | 0 -> surface, 1 -> texture      |
 * | background                | background (int)                                  | 0 -> false, 1 -> true           |
 * | speedPlayback             | speed_playback (float)                            | as is                           |
 * | speedLongPress            | speed_long_press, else speed (float)              | as is                           |
 * | subtitleStyleSource       | subtitle_style_source (int)                       | 0 original, 1 system, 2 custom  |
 * | subtitleEdgeType          | subtitle_edge_type (int)                          | 0 none, 1 outline, 2 dropShadow |
 * | subtitle*Color            | subtitle_*_color (int, signed ARGB)               | parse() makes it unsigned       |
 * | subtitle* (other)         | same-named float / int keys                       | as is                           |
 * | video*, audio*, preload*  | same-named keys (float / int / boolean)           | as is                           |
 * | audioChannelMode          | audio_channel_mode (int)                          | 0 auto, 1 stereo, 2 mono, 3 reverse |
 * | homeSiteKey               | Config.home of the active VOD config (DB column)  | as is                           |
 *
 * Not migrated: "decode" (no Java reader left), danmaku / wallpaper / theme keys
 * (not in the RN schema), legacy "caption" (boolean, superseded by subtitle_style_source).
 */
const SETTING_RULES: Partial<Record<SettingKey, SettingRule>> = {
  doh: { java: 'doh', type: 'string' },
  ua: { java: 'ua', type: 'string' },
  siteMode: { java: 'site_mode', type: 'int' },
  airplay: { java: 'airplay', type: 'boolean' },
  airplayName: { java: 'airplay_name', type: 'string' },
  incognito: { java: 'incognito', type: 'boolean' },
  adblock: { java: 'adblock', type: 'boolean' },

  playerEngine: { java: 'player_engine', type: 'int', map: enumOf(['video', 'mpv']) },
  playerDebug: { java: 'player_debug', type: 'boolean' },
  mpvGpuNext: { java: 'mpv_gpu_next', type: 'boolean' },
  mpvVulkan: { java: 'mpv_vulkan', type: 'boolean' },
  render: { java: 'render', type: 'int', map: enumOf(['surface', 'texture']) },
  scale: { java: 'scale', type: 'int' },
  background: { java: 'background', type: 'int', map: enumOf([false, true]) },
  buffer: { java: 'buffer', type: 'int' },

  audioPassThrough: { java: 'decode_audio_pass_through', type: 'boolean', legacy: 'audio_pass_through' },
  audioPrefer: { java: 'decode_audio_prefer', type: 'boolean', legacy: 'audio_prefer' },
  videoPrefer: { java: 'decode_video_prefer', type: 'boolean', legacy: 'video_prefer' },
  preferAac: { java: 'decode_prefer_aac', type: 'boolean', legacy: 'prefer_aac' },
  tunnel: { java: 'decode_tunnel', type: 'boolean', legacy: 'tunnel' },

  speedPlayback: { java: 'speed_playback', type: 'float' },
  speedLongPress: { java: 'speed_long_press', type: 'float', legacy: 'speed' },
  speedSkipSilence: { java: 'speed_skip_silence', type: 'boolean' },

  subtitleSearchToken: { java: 'subtitle_search_token', type: 'string' },
  subtitleStyleSource: { java: 'subtitle_style_source', type: 'int', map: enumOf(['original', 'system', 'custom']) },
  subtitleScale: { java: 'subtitle_scale', type: 'float' },
  subtitlePosition: { java: 'subtitle_position', type: 'float' },
  subtitleForegroundColor: { java: 'subtitle_foreground_color', type: 'int' },
  subtitleForegroundOpacity: { java: 'subtitle_foreground_opacity', type: 'float' },
  subtitleBackgroundColor: { java: 'subtitle_background_color', type: 'int' },
  subtitleBackgroundOpacity: { java: 'subtitle_background_opacity', type: 'float' },
  subtitleEdgeType: { java: 'subtitle_edge_type', type: 'int', map: enumOf(['none', 'outline', 'dropShadow']) },
  subtitleEdgeColor: { java: 'subtitle_edge_color', type: 'int' },
  subtitleEdgeOpacity: { java: 'subtitle_edge_opacity', type: 'float' },
  subtitleEdgeWidth: { java: 'subtitle_edge_width', type: 'float' },
  subtitleShadow: { java: 'subtitle_shadow', type: 'float' },
  subtitleSecondaryTrack: { java: 'subtitle_secondary_track', type: 'int' },
  subtitleSecondaryPosition: { java: 'subtitle_secondary_position', type: 'float' },

  bootLive: { java: 'boot_live', type: 'boolean' },
  across: { java: 'across', type: 'boolean' },
  change: { java: 'change', type: 'boolean' },
  invert: { java: 'invert', type: 'boolean' },
  scaleLive: { java: 'scale_live', type: 'int' },

  videoEnabled: { java: 'video_enabled', type: 'boolean' },
  videoPreset: { java: 'video_preset', type: 'int' },
  videoSaturation: { java: 'video_saturation', type: 'float' },
  videoContrast: { java: 'video_contrast', type: 'float' },
  videoBrightness: { java: 'video_brightness', type: 'float' },
  videoSharpness: { java: 'video_sharpness', type: 'float' },
  videoShadow: { java: 'video_shadow', type: 'float' },
  videoGamma: { java: 'video_gamma', type: 'float' },
  videoHue: { java: 'video_hue', type: 'float' },
  videoTemperature: { java: 'video_temperature', type: 'float' },

  audioEnabled: { java: 'audio_enabled', type: 'boolean' },
  audioPreset: { java: 'audio_preset', type: 'int' },
  audioStability: { java: 'audio_stability', type: 'int' },
  audioDialogue: { java: 'audio_dialogue', type: 'int' },
  audioBoost: { java: 'audio_boost', type: 'int' },
  audioPreamp: { java: 'audio_preamp', type: 'int' },
  audioLoudness: { java: 'audio_loudness', type: 'boolean' },
  audioCenterGain: { java: 'audio_center_gain', type: 'int' },
  audioBalance: { java: 'audio_balance', type: 'int' },
  audioChannelMode: { java: 'audio_channel_mode', type: 'int', map: enumOf(['auto', 'stereo', 'mono', 'reverse']) },

  preload: { java: 'preload', type: 'boolean' },
  preloadNextEpisode: { java: 'preload_next_episode', type: 'boolean' },
  preloadThreads: { java: 'preload_threads', type: 'int' },
  preloadSize: { java: 'preload_size', type: 'int' },
  preloadTime: { java: 'preload_time', type: 'int' },
};

/** Settings the Java app has stored, validated by the RN schema; `home` is Config.home of the active VOD config. */
export function mapSettings(prefs: LegacyPrefs, home?: string): Partial<Settings> {
  const result: Partial<Record<SettingKey, unknown>> = {};
  for (const [key, rule] of Object.entries(SETTING_RULES) as [SettingKey, SettingRule][]) {
    let value = pref(prefs, rule.java, rule.type);
    if (value === undefined && rule.legacy) value = pref(prefs, rule.legacy, rule.type);
    if (value === undefined) continue;
    if (rule.map) value = rule.map(value as never);
    const parsed = parseSetting(key, value);
    if (parsed !== undefined) result[key] = parsed;
  }
  if (home) {
    const parsed = parseSetting('homeSiteKey', home);
    if (parsed !== undefined) result.homeSiteKey = parsed;
  }
  return result as Partial<Settings>;
}

// ---------------------------------------------------------------------------
// Database rows

const text = (value: LegacyRow[string] | undefined): string => (typeof value === 'string' ? value : '');
const int = (value: LegacyRow[string] | undefined): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
/** Millisecond fields; C.TIME_UNSET and other negatives become TIME_UNSET. */
const ms = (value: LegacyRow[string] | undefined): number => {
  const n = int(value);
  return n === undefined || n < 0 ? TIME_UNSET : n;
};

/** A Config row (type 0 = VOD, 1 = live; others are skipped). */
export interface LegacyConfig {
  id: number;
  url: string;
  name: string;
  time: number;
  home: string;
}

export interface LegacyConfigs {
  /** Oldest first, so re-adding in order keeps the Java ordering. */
  vod: LegacyConfig[];
  live: LegacyConfig[];
  /** Most recently used per type (ConfigDao.findOne: ORDER BY time DESC LIMIT 1). */
  activeVod?: LegacyConfig;
  activeLive?: LegacyConfig;
}

export function mapConfigs(rows: readonly LegacyRow[]): LegacyConfigs {
  const vod: LegacyConfig[] = [];
  const live: LegacyConfig[] = [];
  for (const row of rows) {
    const id = int(row.id);
    const url = text(row.url).trim();
    if (id === undefined || !url) continue;
    const entry: LegacyConfig = { id, url, name: text(row.name), time: Math.max(int(row.time) ?? 0, 0), home: text(row.home) };
    if (row.type === 0) vod.push(entry);
    else if (row.type === 1) live.push(entry);
  }
  const byTime = (a: LegacyConfig, b: LegacyConfig) => a.time - b.time;
  vod.sort(byTime);
  live.sort(byTime);
  return { vod, live, activeVod: vod.at(-1), activeLive: live.at(-1) };
}

/** Java keys are "siteKey@@@vodId@@@cid"; RN keys drop the cid suffix. */
function vodKey(key: string): string | undefined {
  const [siteKey, vodId] = key.split(SYMBOL);
  return siteKey && vodId ? `${siteKey}${SYMBOL}${vodId}` : undefined;
}

/** History record still carrying the Java config id in `cid`. */
export function mapHistory(rows: readonly LegacyRow[]): History[] {
  const result: History[] = [];
  for (const row of rows) {
    const key = vodKey(text(row.key));
    const cid = int(row.cid);
    if (!key || cid === undefined) continue;
    const speed = typeof row.speed === 'number' && row.speed > 0 ? row.speed : 1;
    result.push({
      key,
      cid,
      vodPic: text(row.vodPic),
      vodName: text(row.vodName),
      vodFlag: text(row.vodFlag),
      vodRemarks: text(row.vodRemarks),
      episodeUrl: text(row.episodeUrl),
      revSort: row.revSort === 1,
      revPlay: row.revPlay === 1,
      createTime: int(row.createTime) ?? 0,
      opening: ms(row.opening),
      ending: ms(row.ending),
      position: ms(row.position),
      duration: ms(row.duration),
      speed,
      scale: int(row.scale) ?? -1,
    });
  }
  return result;
}

/** Keep records; VOD keeps still carry the Java config id in `cid`, live keeps (by channel name) use cid 0. */
export function mapKeep(rows: readonly LegacyRow[]): Keep[] {
  const result: Keep[] = [];
  for (const row of rows) {
    const type = int(row.type);
    const raw = text(row.key);
    const key = type === 0 ? vodKey(raw) : type === 1 ? raw : undefined;
    const cid = type === 1 ? 0 : int(row.cid);
    if (!key || cid === undefined || type === undefined) continue;
    result.push({
      key,
      cid,
      type,
      siteName: text(row.siteName),
      vodName: text(row.vodName),
      vodPic: text(row.vodPic),
      createTime: int(row.createTime) ?? 0,
    });
  }
  return result;
}
