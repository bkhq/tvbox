import { useCallback, useSyncExternalStore } from 'react';

import type { SettingKey, Settings } from './schema';
import { appSettings, type SettingsStore } from './settings';

/** Subscribe a component to one setting; the setter validates and persists. */
export function useSetting<K extends SettingKey>(
  key: K,
  store: SettingsStore = appSettings,
): [Settings[K], (value: Settings[K]) => Promise<void>] {
  const value = useSyncExternalStore(
    useCallback((onChange: () => void) => store.subscribeKey(key, onChange), [store, key]),
    () => store.get(key),
  );
  const setValue = useCallback((next: Settings[K]) => store.set(key, next), [store, key]);
  return [value, setValue];
}
