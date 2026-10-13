import type { KeyValueStore } from './keyValueStore';

/** Versioned storage key; bump the version when the stored shape changes. */
export function storageKey(name: string, version: number): string {
  return `tvbox.${name}.v${version}`;
}

/** Read and parse a JSON value; missing or corrupt entries yield undefined. */
export async function readJson(store: KeyValueStore, key: string): Promise<unknown> {
  const raw = await store.getItem(key);
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

export function writeJson(store: KeyValueStore, key: string, value: unknown): Promise<void> {
  return store.setItem(key, JSON.stringify(value));
}

export interface JsonCell<T> {
  read(): Promise<T>;
  /** Read-modify-write; cells sharing a store and key run strictly in order. */
  update<R>(fn: (value: T) => { value: T; result: R }): Promise<R>;
}

const queuesByStore = new WeakMap<KeyValueStore, Map<string, Promise<unknown>>>();

/** One JSON document under one key, normalised on read by `parse`. */
export function jsonCell<T>(store: KeyValueStore, key: string, parse: (raw: unknown) => T): JsonCell<T> {
  let queues = queuesByStore.get(store);
  if (!queues) {
    queues = new Map();
    queuesByStore.set(store, queues);
  }
  const shared = queues;
  const enqueue = <R>(task: () => Promise<R>): Promise<R> => {
    const next = (shared.get(key) ?? Promise.resolve()).then(task);
    shared.set(key, next.catch(() => undefined));
    return next;
  };
  return {
    read: () => enqueue(async () => parse(await readJson(store, key))),
    update: (fn) =>
      enqueue(async () => {
        const { value, result } = fn(parse(await readJson(store, key)));
        await writeJson(store, key, value);
        return result;
      }),
  };
}
