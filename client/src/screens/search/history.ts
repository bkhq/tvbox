import { useCallback, useMemo } from 'react';

import { useSetting } from '../../core/settings';

/** SearchActivity's RecordAdapter keeps the latest ten keywords. */
export const HISTORY_LIMIT = 10;

/** Parses a stored JSON string array (the "keyword" and "hot" settings); anything else is empty. */
export function parseWords(text: string): string[] {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [];
  } catch {
    return [];
  }
}

/** Moves `keyword` to the front, keeping the latest HISTORY_LIMIT entries. */
export function withKeyword(history: readonly string[], keyword: string): string[] {
  return [keyword, ...history.filter((item) => item !== keyword)].slice(0, HISTORY_LIMIT);
}

/** Search history persisted in the "keyword" setting, as the Java app does. */
export function useSearchHistory() {
  const [stored, setStored] = useSetting('keyword');
  const history = useMemo(() => parseWords(stored), [stored]);
  const save = useCallback((items: readonly string[]) => void setStored(JSON.stringify(items)), [setStored]);
  const add = useCallback((keyword: string) => save(withKeyword(history, keyword)), [history, save]);
  const remove = useCallback((keyword: string) => save(history.filter((item) => item !== keyword)), [history, save]);
  return { history, add, remove };
}
