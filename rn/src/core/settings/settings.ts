import { isObject } from '../types';
import { readJson, storageKey, writeJson } from '../storage/json';
import { asyncStorageStore, type KeyValueStore } from '../storage/keyValueStore';
import { defaultSettings, parseSetting, SETTING_KEYS, type SettingKey, type Settings } from './schema';

export const SETTINGS_STORAGE_KEY = storageKey('settings', 1);

export class InvalidSettingError extends Error {
  constructor(
    readonly key: string,
    readonly value: unknown,
  ) {
    super(`Invalid value for setting "${key}": ${JSON.stringify(value)}`);
    this.name = 'InvalidSettingError';
  }
}

export type SettingsListener = (settings: Settings, changed: readonly SettingKey[]) => void;
export type SettingListener<K extends SettingKey> = (value: Settings[K]) => void;

export interface SettingsStore {
  /** Read persisted values; invalid or missing keys fall back to defaults. */
  loadSettings(): Promise<Settings>;
  /** Current snapshot; a new object after every change. */
  getSettings(): Settings;
  get<K extends SettingKey>(key: K): Settings[K];
  /**
   * Validate, apply and persist. Throws InvalidSettingError synchronously for
   * invalid values; the returned promise settles once the value is written.
   */
  set<K extends SettingKey>(key: K, value: Settings[K]): Promise<void>;
  subscribe(listener: SettingsListener): () => void;
  subscribeKey<K extends SettingKey>(key: K, listener: SettingListener<K>): () => void;
}

/**
 * Cross-key rules from the Java putters: ExoPlayer tunnelling needs the
 * surface renderer (PlayerSetting.putEngine / putRender, DecodeSetting.putTunnel).
 */
function applyLinked(next: Settings, key: SettingKey): void {
  if (next.playerEngine !== 'video' || !next.tunnel) return;
  if (key === 'render' && next.render === 'texture') next.tunnel = false;
  else next.render = 'surface';
}

export function createSettingsStore(store: KeyValueStore): SettingsStore {
  let settings = defaultSettings();
  let writes: Promise<void> = Promise.resolve();
  const listeners = new Set<SettingsListener>();

  const commit = (next: Settings) => {
    const changed = SETTING_KEYS.filter((key) => !Object.is(next[key], settings[key]));
    if (changed.length === 0) return false;
    settings = next;
    for (const listener of [...listeners]) listener(settings, changed);
    return true;
  };

  return {
    async loadSettings() {
      const stored = await readJson(store, SETTINGS_STORAGE_KEY);
      const json = isObject(stored) ? stored : {};
      const next = defaultSettings();
      for (const key of SETTING_KEYS) {
        const value = parseSetting(key, json[key]);
        if (value !== undefined) (next as Record<SettingKey, unknown>)[key] = value;
      }
      commit(next);
      return settings;
    },
    getSettings: () => settings,
    get: (key) => settings[key],
    set(key, value) {
      const parsed = parseSetting(key, value);
      if (parsed === undefined) throw new InvalidSettingError(key, value);
      const next = { ...settings, [key]: parsed };
      applyLinked(next, key);
      if (!commit(next)) return writes;
      writes = writes.catch(() => undefined).then(() => writeJson(store, SETTINGS_STORAGE_KEY, settings));
      return writes;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    subscribeKey(key, listener) {
      const wrapped: SettingsListener = (current, changed) => {
        if (changed.includes(key)) listener(current[key]);
      };
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
  };
}

/** App-wide settings persisted in AsyncStorage. */
export const appSettings = createSettingsStore(asyncStorageStore);

export const loadSettings = () => appSettings.loadSettings();
export const getSettings = () => appSettings.getSettings();
export const get = <K extends SettingKey>(key: K) => appSettings.get(key);
export const set = <K extends SettingKey>(key: K, value: Settings[K]) => appSettings.set(key, value);
export const subscribe = (listener: SettingsListener) => appSettings.subscribe(listener);
export const subscribeKey = <K extends SettingKey>(key: K, listener: SettingListener<K>) =>
  appSettings.subscribeKey(key, listener);
