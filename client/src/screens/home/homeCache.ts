import { type KeyValueStore, readJson, storageKey, writeJson } from '../../core/storage';
import { getUserDataStore } from '../../core/userData';
import type { HomeContent } from './homeContent';

/**
 * The last home content of a source, so the page opens on it while the source reloads. Memory keeps every source
 * seen in this run; storage keeps the most recent one, which is the home site on the next start.
 */
const KEY = storageKey('homeCache', 1);

interface Entry {
  key: string;
  content: HomeContent;
}

let cache: { store: KeyValueStore; memory: Map<string, HomeContent> } | undefined;

// Bound to the user data store, so swapping it (tests) starts empty.
function current() {
  const store = getUserDataStore();
  if (cache?.store !== store) cache = { store, memory: new Map() };
  return cache;
}

function isEntry(value: unknown): value is Entry {
  if (!value || typeof value !== 'object') return false;
  const { key, content } = value as Partial<Entry>;
  return (
    typeof key === 'string' &&
    !!content &&
    Array.isArray(content.classes) &&
    Array.isArray(content.featured) &&
    Array.isArray(content.rows) &&
    typeof content.featuredSiteKey === 'string'
  );
}

/** Content of `key` already in memory. */
export function peekHomeCache(key: string): HomeContent | undefined {
  return current().memory.get(key);
}

/** Content of `key` from memory or storage; undefined when none or it belongs to another source. */
export async function readHomeCache(key: string): Promise<HomeContent | undefined> {
  const { store, memory } = current();
  const hit = memory.get(key);
  if (hit) return hit;
  const saved = await readJson(store, KEY).catch(() => undefined);
  if (!isEntry(saved) || saved.key !== key) return undefined;
  memory.set(key, saved.content);
  return saved.content;
}

export function writeHomeCache(key: string, content: HomeContent): void {
  const { store, memory } = current();
  memory.set(key, content);
  writeJson(store, KEY, { key, content } satisfies Entry).catch(() => undefined);
}
