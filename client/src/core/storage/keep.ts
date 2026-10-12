import { isObject, type Keep, normalizeKeep } from '../types';
import { jsonCell, storageKey } from './json';
import type { KeyValueStore } from './keyValueStore';

/** Keep.type: 0 = VOD (scoped to a config), 1 = live channel (global). */
export type KeepType = 0 | 1;

export type KeepInput = Omit<Keep, 'createTime' | 'type'> & { type?: KeepType };

function parseRecords(raw: unknown): Keep[] {
  return Array.isArray(raw) ? raw.filter(isObject).map(normalizeKeep) : [];
}

/** KeepDao matching: VOD keeps by (cid, key), live keeps by key alone. */
function matches(item: Keep, key: string, cid: number, type: KeepType): boolean {
  return item.type === type && item.key === key && (type === 1 || item.cid === cid);
}

export interface KeepRepository {
  /** Insert or replace; stamps createTime with now. */
  add(input: KeepInput): Promise<Keep>;
  remove(key: string, cid: number, type?: KeepType): Promise<void>;
  isKept(key: string, cid: number, type?: KeepType): Promise<boolean>;
  /** Newest first: VOD keeps of one config, or every live keep. */
  list(cid: number, type?: KeepType): Promise<Keep[]>;
}

export function createKeepRepository(store: KeyValueStore, now: () => number = Date.now): KeepRepository {
  const cell = jsonCell(store, storageKey('keep', 1), parseRecords);

  return {
    add: (input) =>
      cell.update((records) => {
        const type = input.type ?? 0;
        const record: Keep = { ...input, type, createTime: now() };
        const others = records.filter((item) => !matches(item, input.key, input.cid, type));
        return { value: [...others, record], result: record };
      }),
    remove: (key, cid, type = 0) =>
      cell.update((records) => ({ value: records.filter((item) => !matches(item, key, cid, type)), result: undefined })),
    isKept: async (key, cid, type = 0) => (await cell.read()).some((item) => matches(item, key, cid, type)),
    list: async (cid, type = 0) =>
      (await cell.read())
        .filter((item) => item.type === type && (type === 1 || item.cid === cid))
        .sort((a, b) => b.createTime - a.createTime),
  };
}
