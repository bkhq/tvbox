import { HOME_RESET_KEY, resetHomeSiteOnce } from '../homeReset';
import { createSettingsStore } from '../settings';
import { MemoryStore } from '../storage';

async function setup(saved: string) {
  const store = new MemoryStore();
  const settings = createSettingsStore(store);
  await settings.loadSettings();
  if (saved) await settings.set('homeSiteKey', saved);
  return { store, settings };
}

it('clears a saved home site once, so the recommendation home opens', async () => {
  const { store, settings } = await setup('豆瓣');
  await resetHomeSiteOnce(store, settings);
  expect(settings.get('homeSiteKey')).toBe('');
  expect(await store.getItem(HOME_RESET_KEY)).not.toBeNull();
});

it('keeps a home site picked after the reset', async () => {
  const { store, settings } = await setup('豆瓣');
  await resetHomeSiteOnce(store, settings);
  await settings.set('homeSiteKey', '热播');
  await resetHomeSiteOnce(store, settings);
  expect(settings.get('homeSiteKey')).toBe('热播');
});
