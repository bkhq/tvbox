import { type History, isObject, normalizeHistory } from '../types';
import { jsonCell, storageKey } from './json';
import type { KeyValueStore } from './keyValueStore';

/** AppDatabase.SYMBOL: separator inside history / keep keys. */
export const KEY_SYMBOL = '@@@';
/** Constant.HISTORY_TIME: records older than 60 days are dropped. */
export const HISTORY_TIME = 60 * 24 * 60 * 60 * 1000;
/** HistoryDao.find LIMIT: newest records kept per config. */
export const HISTORY_MAX = 60;
/** Stand-in for Media3 C.TIME_UNSET on opening / ending / position / duration. */
export const TIME_UNSET = -1;

export function historyKey(siteKey: string, vodId: string): string {
  return `${siteKey}${KEY_SYMBOL}${vodId}`;
}

export function splitHistoryKey(key: string): { siteKey: string; vodId: string } {
  const [siteKey = '', vodId = ''] = key.split(KEY_SYMBOL);
  return { siteKey, vodId };
}

/** Upsert input: identity plus any fields to change. */
export type HistoryInput = Pick<History, 'key' | 'cid'> & Partial<Omit<History, 'key' | 'cid' | 'createTime'>>;

/** History() constructor defaults. */
function createHistory(key: string, cid: number): History {
  return {
    key,
    cid,
    vodPic: '',
    vodName: '',
    vodFlag: '',
    vodRemarks: '',
    episodeUrl: '',
    revSort: false,
    revPlay: false,
    createTime: 0,
    opening: TIME_UNSET,
    ending: TIME_UNSET,
    position: TIME_UNSET,
    duration: TIME_UNSET,
    speed: 1,
    scale: -1,
  };
}

function parseRecords(raw: unknown): History[] {
  return Array.isArray(raw) ? raw.filter(isObject).map(normalizeHistory) : [];
}

const byTimeDesc = (a: History, b: History) => b.createTime - a.createTime;

/** Drop expired records and keep the newest HISTORY_MAX per config. */
function trim(records: History[], now: number): History[] {
  const counts = new Map<number, number>();
  return [...records].sort(byTimeDesc).filter((item) => {
    if (item.createTime < now - HISTORY_TIME) return false;
    const count = (counts.get(item.cid) ?? 0) + 1;
    counts.set(item.cid, count);
    return count <= HISTORY_MAX;
  });
}

export interface HistoryRepository {
  /** Insert or merge into the record for (cid, key); stamps createTime with now. */
  upsert(input: HistoryInput): Promise<History>;
  get(cid: number, key: string): Promise<History | undefined>;
  /** Records for one config, newest first, within HISTORY_TIME and HISTORY_MAX. */
  list(cid: number): Promise<History[]>;
  delete(cid: number, key: string): Promise<void>;
  /** Delete every record of one config. */
  clear(cid: number): Promise<void>;
}

export function createHistoryRepository(store: KeyValueStore, now: () => number = Date.now): HistoryRepository {
  const cell = jsonCell(store, storageKey('history', 1), parseRecords);
  const same = (cid: number, key: string) => (item: History) => item.cid === cid && item.key === key;

  return {
    upsert: (input) =>
      cell.update((records) => {
        const time = now();
        const existing = records.find(same(input.cid, input.key));
        const record: History = { ...(existing ?? createHistory(input.key, input.cid)), ...input, createTime: time };
        const others = records.filter((item) => item !== existing);
        return { value: trim([...others, record], time), result: record };
      }),
    get: async (cid, key) => (await cell.read()).find(same(cid, key)),
    list: async (cid) => trim(await cell.read(), now()).filter((item) => item.cid === cid),
    delete: (cid, key) =>
      cell.update((records) => ({ value: records.filter((item) => !same(cid, key)(item)), result: undefined })),
    clear: (cid) => cell.update((records) => ({ value: records.filter((item) => item.cid !== cid), result: undefined })),
  };
}
