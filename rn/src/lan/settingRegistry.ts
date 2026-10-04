import type { Doh } from '../core/types';
import type { SettingKey, Settings } from '../core/settings/schema';
import { InvalidSettingError, type SettingsStore } from '../core/settings/settings';

/**
 * Port of SettingRegistry.java: every setting the phone control page can show and change.
 * Web keys, groups, labels and ranges follow the Java registry; items the rn schema lacks
 * (size, dolby_vision, danmaku) are left out.
 */

type Store = Pick<SettingsStore, 'get' | 'set'>;
type Get = Store['get'];

export type SettingType = 'bool' | 'enum' | 'number' | 'text';

export interface SettingItemJson {
  key: string;
  label: string;
  type: SettingType;
  value: boolean | number | string;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
}

export interface SettingGroupJson {
  key: string;
  items: SettingItemJson[];
}

/** Thrown by SettingRegistry.set when the value does not fit the item. */
export class InvalidSettingValueError extends Error {
  constructor(key: string) {
    super(`Invalid value for ${key}`);
    this.name = 'InvalidSettingValueError';
  }
}

interface Item {
  group: string;
  key: string;
  label: string;
  type: SettingType;
  get(get: Get): boolean | number | string;
  /** Applies an already checked value. */
  set(store: Store, value: string): Promise<void>;
  options?(): string[];
  range?: [min: number, max: number, step: number];
  visible?(get: Get): boolean;
}

/** Doh.get: the built-in resolvers (catvod values-zh-rCN doh_name / doh_url). */
const BUILTIN_DOH: Doh[] = [
  { name: '系统', url: '', ips: [] },
  { name: '腾讯', url: 'https://doh.pub/dns-query', ips: [] },
  { name: '阿里', url: 'https://dns.alidns.com/dns-query', ips: [] },
  { name: '360', url: 'https://doh.360.cn/dns-query', ips: [] },
];

/** VodConfig.getDoh: built-ins, with entries of the active config replacing those with the same url. */
export function dohList(configured: readonly Doh[]): Doh[] {
  const urls = new Set(configured.map((doh) => doh.url));
  return [...BUILTIN_DOH.filter((doh) => !urls.has(doh.url)), ...configured];
}

function storedDohUrl(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value);
    const url = (parsed as { url?: unknown } | null)?.url;
    return typeof url === 'string' ? url : '';
  } catch {
    return '';
  }
}

/** Doh.toString: Gson JSON, empty ips omitted. */
function dohJson(doh: Doh): string {
  return JSON.stringify(doh.ips.length ? doh : { name: doh.name, url: doh.url });
}

type KeysOf<T> = { [K in SettingKey]: Settings[K] extends T ? K : never }[SettingKey];
type BoolKey = KeysOf<boolean>;
type NumberKey = KeysOf<number>;
type TextKey = KeysOf<string>;

const isExo = (get: Get) => get('playerEngine') === 'video';
const isMpv = (get: Get) => get('playerEngine') === 'mpv';
const preloadExo = (get: Get) => get('preload') && isExo(get);

function bool(group: string, key: string, label: string, setting: BoolKey, visible?: Item['visible']): Item {
  return {
    group,
    key,
    label,
    type: 'bool',
    get: (get) => get(setting),
    set: (store, value) => store.set(setting, value === 'true'),
    visible,
  };
}

/** Enum over a string-valued setting: the web value is the index into `values`. */
function choice<K extends SettingKey>(
  group: string,
  key: string,
  label: string,
  setting: K,
  values: readonly Settings[K][],
  options: string[],
): Item {
  return {
    group,
    key,
    label,
    type: 'enum',
    get: (get) => Math.max(0, values.indexOf(get(setting))),
    set: (store, value) => store.set(setting, values[Number(value)] as Settings[K]),
    options: () => options,
  };
}

/** Number with Java's range; `integer` mirrors the `value.intValue()` setters. */
function number(
  group: string,
  key: string,
  label: string,
  setting: NumberKey,
  range: [number, number, number],
  integer: boolean,
  visible?: Item['visible'],
): Item {
  return {
    group,
    key,
    label,
    type: 'number',
    get: (get) => get(setting),
    set: (store, value) => store.set(setting, integer ? Math.trunc(Number(value)) : Number(value)),
    range,
    visible,
  };
}

function text(group: string, key: string, label: string, setting: TextKey, visible?: Item['visible'], trim = false): Item {
  return {
    group,
    key,
    label,
    type: 'text',
    get: (get) => get(setting),
    set: (store, value) => store.set(setting, trim ? value.trim() : value),
    visible,
  };
}

function items(dohs: () => Doh[]): Item[] {
  return [
    // General
    bool('general', 'incognito', '无痕模式', 'incognito'),
    {
      group: 'general',
      key: 'doh',
      label: 'DoH',
      type: 'enum',
      get: (get) => {
        const url = storedDohUrl(get('doh'));
        return Math.max(0, dohs().findIndex((doh) => doh.url === url));
      },
      set: (store, value) => store.set('doh', dohJson(dohs()[Number(value)] as Doh)),
      options: () => dohs().map((doh) => doh.name),
    },
    bool('general', 'airplay', 'AirPlay', 'airplay'),
    text('general', 'airplay_name', 'AirPlay 名称', 'airplayName', (get) => get('airplay'), true),
    // Player
    choice('player', 'engine', '播放引擎', 'playerEngine', ['video', 'mpv'], ['EXO', 'MPV']),
    choice('player', 'render', '渲染方式', 'render', ['surface', 'texture'], ['Surface', 'Texture']),
    {
      group: 'player',
      key: 'scale',
      label: '缩放比例',
      type: 'enum',
      get: (get) => get('scale'),
      set: (store, value) => store.set('scale', Number(value)),
      options: () => ['原始', '16:9', '4:3', '填充', '裁剪'],
    },
    bool('player', 'background', '后台播放', 'background'),
    number('player', 'buffer', '缓冲时间', 'buffer', [1, 10, 1], true, isExo),
    bool('player', 'adblock', '智能去广', 'adblock', isExo),
    bool('player', 'mpv_gpu_next', 'gpu-next', 'mpvGpuNext', isMpv),
    bool('player', 'mpv_vulkan', 'vulkan', 'mpvVulkan', isMpv),
    text('player', 'ua', 'User-Agent', 'ua'),
    // Speed
    number('speed', 'speed', '播放速度', 'speedPlayback', [0.1, 5, 0.05], false),
    number('speed', 'long_press', '长按倍速', 'speedLongPress', [2, 5, 0.05], false),
    bool('speed', 'skip_silence', '跳过无声片段', 'speedSkipSilence'),
    // Decode
    bool('decode', 'tunnel', '隧道模式', 'tunnel', isExo),
    bool('decode', 'audio_pass_through', '音频直通', 'audioPassThrough'),
    bool('decode', 'audio_prefer', '音频软解', 'audioPrefer', isExo),
    bool('decode', 'video_prefer', '视频软解', 'videoPrefer', isExo),
    bool('decode', 'aac', 'AAC优先', 'preferAac', isExo),
    // Preload
    bool('preload', 'preload', '预载', 'preload'),
    bool('preload', 'preload_next', '预载下集', 'preloadNextEpisode', preloadExo),
    number('preload', 'preload_threads', '预载线程', 'preloadThreads', [1, 10, 1], true, preloadExo),
    number('preload', 'preload_size', '预载容量', 'preloadSize', [128, 4096, 128], true, preloadExo),
    number('preload', 'preload_time', '预载时间', 'preloadTime', [20, 120, 1], true, (get) => get('preload')),
    // Live
    bool('live', 'live_change', '换源', 'change'),
    bool('live', 'live_invert', '反转', 'invert'),
    bool('live', 'live_across', '跨类', 'across'),
    bool('live', 'live_boot', '开机直播', 'bootLive'),
  ];
}

function isIndex(value: string, size: number): boolean {
  if (!/^[+-]?\d+$/.test(value.trim())) return false;
  const index = Number(value);
  return index >= 0 && index < size;
}

function isInRange(value: string, min: number, max: number): boolean {
  const number = Number(value.trim());
  return value.trim() !== '' && !Number.isNaN(number) && number >= min && number <= max;
}

function check(item: Item, value: string): boolean {
  switch (item.type) {
    case 'bool':
      return value === 'true' || value === 'false';
    case 'enum':
      return isIndex(value, item.options?.().length ?? 0);
    case 'number':
      return item.range ? isInRange(value, item.range[0], item.range[1]) : false;
    case 'text':
      return true;
  }
}

export interface SettingRegistry {
  /** All groups with their visible items, in screen order. */
  toJson(): SettingGroupJson[];
  /**
   * Resolves false when the key is unknown.
   * @throws InvalidSettingValueError when the value does not fit the item
   */
  set(key: string, value: string): Promise<boolean>;
}

export interface SettingRegistryDeps {
  settings: Store;
  /** Doh entries of the active VOD config. */
  configDoh?: () => readonly Doh[];
}

export function createSettingRegistry({ settings, configDoh = () => [] }: SettingRegistryDeps): SettingRegistry {
  const list = items(() => dohList(configDoh()));
  const byKey = new Map(list.map((item) => [item.key, item]));
  const get: Get = (key) => settings.get(key);

  return {
    toJson() {
      const groups = new Map<string, SettingItemJson[]>();
      for (const item of list) {
        if (item.visible && !item.visible(get)) continue;
        const json: SettingItemJson = { key: item.key, label: item.label, type: item.type, value: item.get(get) };
        if (item.type === 'enum') json.options = item.options?.() ?? [];
        if (item.range) [json.min, json.max, json.step] = item.range;
        const group = groups.get(item.group) ?? [];
        group.push(json);
        groups.set(item.group, group);
      }
      return [...groups].map(([key, groupItems]) => ({ key, items: groupItems }));
    },
    async set(key, value) {
      const item = byKey.get(key);
      if (!item) return false;
      if (!check(item, value)) throw new InvalidSettingValueError(key);
      try {
        await item.set(settings, value);
      } catch (error) {
        if (error instanceof InvalidSettingError) throw new InvalidSettingValueError(key);
        throw error;
      }
      return true;
    },
  };
}
