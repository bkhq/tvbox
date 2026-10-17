import type { SettingsStore } from './settings';
import { storageKey } from './storage/json';
import type { KeyValueStore } from './storage/keyValueStore';

/** Set once the saved home site has been cleared for the worker's recommendation home. */
export const HOME_RESET_KEY = storageKey('homeReset', 1);

/**
 * Clears the saved home site once, so an upgraded app opens the config's first site: the worker's
 * recommendation home (worker/docs/plan/recommend-home.md). A site picked afterwards is kept.
 */
export async function resetHomeSiteOnce(store: KeyValueStore, settings: SettingsStore): Promise<void> {
  if ((await store.getItem(HOME_RESET_KEY)) !== null) return;
  if (settings.get('homeSiteKey')) await settings.set('homeSiteKey', '');
  await store.setItem(HOME_RESET_KEY, String(Date.now()));
}
