import { type ConfigEntry, isObject, num, str } from '../types';
import { jsonCell, storageKey } from './json';
import type { KeyValueStore } from './keyValueStore';

/** VOD and live addresses are saved separately, like Config.type 0 and 1. */
export type ConfigKind = 'vod' | 'live';

/** A saved config; `id` is the config id (`cid`) history and keep records hang off. */
export interface SavedConfig extends ConfigEntry {
  id: number;
}

interface ConfigState {
  nextId: number;
  active: string;
  items: SavedConfig[];
}

function parseState(raw: unknown): ConfigState {
  const json = isObject(raw) ? raw : {};
  const items = Array.isArray(json.items)
    ? json.items.filter(isObject).map((item) => ({ id: num(item.id), url: str(item.url), name: str(item.name), time: num(item.time) }))
    : [];
  const maxId = items.reduce((max, item) => Math.max(max, item.id), 0);
  return { nextId: Math.max(num(json.nextId, 1), maxId + 1), active: str(json.active), items };
}

export interface ConfigRepository {
  /** Saved configs, most recently used first (Config.getAll). */
  list(): Promise<SavedConfig[]>;
  find(url: string): Promise<SavedConfig | undefined>;
  /** Insert or update by url; bumps the time to `now`. */
  add(entry: { url: string; name?: string }): Promise<SavedConfig>;
  /** Remove by url; clears the active url when it was the active one. */
  remove(url: string): Promise<void>;
  /** Mark a saved config as the active one; throws when the url is not saved. */
  setActive(url: string): Promise<SavedConfig>;
  getActive(): Promise<SavedConfig | undefined>;
}

export function createConfigRepository(
  store: KeyValueStore,
  kind: ConfigKind,
  now: () => number = Date.now,
): ConfigRepository {
  const cell = jsonCell(store, storageKey(`configs.${kind}`, 1), parseState);
  const sorted = (items: SavedConfig[]) => [...items].sort((a, b) => b.time - a.time);

  return {
    list: async () => sorted((await cell.read()).items),
    find: async (url) => (await cell.read()).items.find((item) => item.url === url),
    add: ({ url, name }) =>
      cell.update((state) => {
        const existing = state.items.find((item) => item.url === url);
        const entry: SavedConfig = existing
          ? { ...existing, name: name ?? existing.name, time: now() }
          : { id: state.nextId, url, name: name ?? '', time: now() };
        const items = existing ? state.items.map((item) => (item.url === url ? entry : item)) : [...state.items, entry];
        return { value: { ...state, items, nextId: existing ? state.nextId : state.nextId + 1 }, result: entry };
      }),
    remove: (url) =>
      cell.update((state) => ({
        value: { ...state, items: state.items.filter((item) => item.url !== url), active: state.active === url ? '' : state.active },
        result: undefined,
      })),
    setActive: (url) =>
      cell.update((state) => {
        const entry = state.items.find((item) => item.url === url);
        if (!entry) throw new Error(`Config not saved: ${url}`);
        return { value: { ...state, active: url }, result: entry };
      }),
    getActive: async () => {
      const state = await cell.read();
      return state.items.find((item) => item.url === state.active);
    },
  };
}
