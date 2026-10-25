import {
  asyncStorageStore,
  createHistoryRepository,
  createKeepRepository,
  type HistoryRepository,
  type KeepRepository,
  type KeyValueStore,
} from './storage';

/**
 * App-wide user data (watch history and favourites), created lazily over
 * AsyncStorage. Screens and the player share these instances; tests swap the
 * backing store with setUserDataStore.
 */

let store: KeyValueStore = asyncStorageStore;
let history: HistoryRepository | undefined;
let keep: KeepRepository | undefined;

/** The store behind user data; other per-device caches persist through it too. */
export function getUserDataStore(): KeyValueStore {
  return store;
}

export function getHistoryRepository(): HistoryRepository {
  history ??= createHistoryRepository(store);
  return history;
}

export function getKeepRepository(): KeepRepository {
  keep ??= createKeepRepository(store);
  return keep;
}

/** Test hook: drops both singletons and rebuilds them on `next` (undefined = AsyncStorage). */
export function setUserDataStore(next: KeyValueStore | undefined): void {
  store = next ?? asyncStorageStore;
  history = undefined;
  keep = undefined;
}
