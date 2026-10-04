import AsyncStorage from '@react-native-async-storage/async-storage';

export type KeyValuePair = readonly [string, string | null];

/** Minimal string key-value persistence used by repositories and settings. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  multiGet(keys: readonly string[]): Promise<readonly KeyValuePair[]>;
}

/** Device persistence backed by AsyncStorage. */
export const asyncStorageStore: KeyValueStore = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
  multiGet: (keys) => AsyncStorage.multiGet(keys),
};

/** Volatile store for tests. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }

  async multiGet(keys: readonly string[]): Promise<readonly KeyValuePair[]> {
    return keys.map((key) => [key, this.data.get(key) ?? null] as const);
  }
}
