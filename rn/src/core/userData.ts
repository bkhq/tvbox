import {
  asyncStorageStore,
  createHistoryRepository,
  createKeepRepository,
  type HistoryRepository,
  type KeepRepository,
  type KeyValueStore,
} from './storage';

/** App-wide history and keep repositories, created lazily over one KeyValueStore. */

let store: KeyValueStore = asyncStorageStore;
let history: HistoryRepository | undefined;
let keep: KeepRepository | undefined;

export function getHistoryRepository(): HistoryRepository {
  history ??= createHistoryRepository(store);
  return history;
}

export function getKeepRepository(): KeepRepository {
  keep ??= createKeepRepository(store);
  return keep;
}

/** Tests: swap the backing store and reset the singletons. */
export function setUserDataStore(next: KeyValueStore): void {
  store = next;
  history = undefined;
  keep = undefined;
}
