/**
 * Live sources for the Live screen, after LiveConfig.load / setHome: the
 * saved live config when one is active, else the `lives` of the loaded VOD
 * config. The selected source (home) and the last channel per source
 * (Live.keep) are persisted in one JSON cell.
 */

import { getBootstrap } from '../../core/bootstrap';
import { loadLiveConfig, selectLiveHome } from '../../core/config/liveConfig';
import {
  asyncStorageStore,
  createConfigRepository,
  type JsonCell,
  jsonCell,
  type KeyValueStore,
  storageKey,
} from '../../core/storage';
import { type Group, isObject, type Live, str } from '../../core/types';
import { getKeepRepository } from '../../core/userData';
import { loadLive } from './load';
import { splitHiddenGroups } from './navigation';

export interface LiveState {
  /** Name of the selected live source. */
  home: string;
  /** keepValue of the last channel, per live source name. */
  keep: Record<string, string>;
}

function parseLiveState(raw: unknown): LiveState {
  const json = isObject(raw) ? raw : {};
  const keep: Record<string, string> = {};
  if (isObject(json.keep)) for (const [name, value] of Object.entries(json.keep)) if (typeof value === 'string') keep[name] = value;
  return { home: str(json.home), keep };
}

/** One cell per store, so updates from the screen run in order. */
const cells = new WeakMap<KeyValueStore, JsonCell<LiveState>>();

function liveCell(store: KeyValueStore): JsonCell<LiveState> {
  let cell = cells.get(store);
  if (!cell) {
    cell = jsonCell(store, storageKey('live.state', 1), parseLiveState);
    cells.set(store, cell);
  }
  return cell;
}

export function readLiveState(store: KeyValueStore = asyncStorageStore): Promise<LiveState> {
  return liveCell(store).read();
}

/** LiveConfig.setHome: remembers the selected live source. */
export function saveLiveHome(name: string, store: KeyValueStore = asyncStorageStore): Promise<void> {
  return liveCell(store).update((state) => ({ value: { ...state, home: name }, result: undefined }));
}

/** Live.keep: remembers the last channel ("group@@@channel@@@url") of a live source. */
export function saveLiveKeep(liveName: string, value: string, store: KeyValueStore = asyncStorageStore): Promise<void> {
  return liveCell(store).update((state) => ({ value: { ...state, keep: { ...state.keep, [liveName]: value } }, result: undefined }));
}

export interface LiveSources {
  lives: Live[];
  home?: Live;
}

export interface LiveSourceOptions {
  store?: KeyValueStore;
  /** `lives` of the active VOD config (default: the bootstrap snapshot). */
  vodLives?: Live[];
  loadConfig?: typeof loadLiveConfig;
}

/** LiveConfig.load: the active live config if saved, else the VOD config's lives; home from the saved name. */
export async function loadLiveSources(options: LiveSourceOptions = {}): Promise<LiveSources> {
  const store = options.store ?? asyncStorageStore;
  const { home } = await readLiveState(store);
  const active = await createConfigRepository(store, 'live').getActive();
  if (active) {
    const config = await (options.loadConfig ?? loadLiveConfig)(active.url, { home: home || undefined });
    return { lives: config.lives, home: config.home };
  }
  const snapshot = getBootstrap().getSnapshot();
  const lives = options.vodLives ?? (snapshot.status === 'ready' ? (snapshot.config?.lives ?? []) : []);
  return { lives, home: selectLiveHome(lives, home || undefined) };
}

export interface LiveGroups {
  live: Live;
  /** Groups shown in the list; indices are the route's groupIndex. */
  visible: Group[];
  /** Password-protected groups (PassDialog unlocks them). */
  hidden: Group[];
}

/** LiveViewModel.getLive: channel groups of `live` with the favourite channels, split by password. */
export async function loadLiveGroups(live: Live, options: { signal?: AbortSignal } = {}): Promise<LiveGroups> {
  const keeps = (await getKeepRepository().list(0, 1)).map((keep) => keep.key);
  const loaded = await loadLive(live, { keeps, signal: options.signal });
  return { live: loaded, ...splitHiddenGroups(loaded.groups) };
}
