import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { asyncStorageStore, type KeyValueStore, MemoryStore } from '../../storage/keyValueStore';
import { defaultSettings, SETTING_KEYS, type Settings } from '../schema';
import { createSettingsStore, InvalidSettingError, SETTINGS_STORAGE_KEY } from '../settings';

describe('settings defaults', () => {
  it('mirrors the Java defaults', () => {
    const settings = createSettingsStore(new MemoryStore());
    expect(settings.getSettings()).toEqual(defaultSettings());
    expect(settings.getSettings()).toMatchObject({
      playerEngine: 'auto',
      decode: 'hard',
      speedPlayback: 1,
      speedLongPress: 2,
      airplay: true,
      airplayName: '',
      background: true,
      adblock: true,
      across: true,
      change: true,
      subtitleScale: 1,
      subtitleForegroundColor: 0xffffffff,
      subtitleEdgeType: 'outline',
      preloadSize: 128,
      preloadTime: 120,
      homeSiteKey: '',
    });
  });

  it('loads defaults from an empty or corrupt store', async () => {
    const store = new MemoryStore();
    await store.setItem(SETTINGS_STORAGE_KEY, 'not json');
    expect(await createSettingsStore(store).loadSettings()).toEqual(defaultSettings());
  });
});

const changes: Partial<Settings> = {
  playerEngine: 'mpv',
  decode: 'soft',
  speedPlayback: 1.5,
  subtitleForegroundColor: 0xffffff00,
  airplay: false,
  airplayName: '客厅',
  background: false,
  homeSiteKey: 'csp_demo',
  preloadThreads: 4,
};

describe.each<[string, () => KeyValueStore]>([
  ['in-memory store', () => new MemoryStore()],
  ['AsyncStorage', () => asyncStorageStore],
])('round trip through %s', (_, makeStore) => {
  beforeEach(() => AsyncStorage.clear());

  it('reloads the values that were set', async () => {
    const store = makeStore();
    const settings = createSettingsStore(store);
    await settings.loadSettings();
    for (const [key, value] of Object.entries(changes)) {
      await settings.set(key as keyof Settings, value as never);
    }
    for (const [key, value] of Object.entries(changes)) expect(settings.get(key as keyof Settings)).toBe(value);

    const reloaded = createSettingsStore(store);
    expect(await reloaded.loadSettings()).toEqual(settings.getSettings());
  });
});

describe('validation', () => {
  it('rejects values of the wrong type or outside an enum', () => {
    const settings = createSettingsStore(new MemoryStore());
    const invalid: [keyof Settings, unknown][] = [
      ['playerEngine', 'exo'],
      ['decode', 1],
      ['airplay', 'yes'],
      ['speedPlayback', Number.NaN],
      ['speedPlayback', '2'],
      ['buffer', 1.5],
      ['subtitleForegroundColor', 0x1ffffffff],
      ['airplayName', null],
    ];
    for (const [key, value] of invalid) {
      expect(() => settings.set(key, value as never)).toThrow(InvalidSettingError);
    }
    expect(settings.getSettings()).toEqual(defaultSettings());
  });

  it('clamps numeric ranges like the Java putters', async () => {
    const settings = createSettingsStore(new MemoryStore());
    await settings.set('speedPlayback', 9);
    await settings.set('speedLongPress', 1);
    await settings.set('buffer', 0);
    await settings.set('preloadSize', 300);
    await settings.set('preloadTime', 1000);
    expect(settings.get('speedPlayback')).toBe(5);
    expect(settings.get('speedLongPress')).toBe(2);
    expect(settings.get('buffer')).toBe(1);
    expect(settings.get('preloadSize')).toBe(256);
    expect(settings.get('preloadTime')).toBe(120);
  });

  it('falls back to defaults for invalid stored values', async () => {
    const store = new MemoryStore();
    await store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ playerEngine: 'vlc', speedPlayback: 99, airplay: false }));
    const settings = await createSettingsStore(store).loadSettings();
    expect(settings.playerEngine).toBe('auto');
    expect(settings.speedPlayback).toBe(5);
    expect(settings.airplay).toBe(false);
  });

  it('keeps tunnelling on the surface renderer for the video engine', async () => {
    const settings = createSettingsStore(new MemoryStore());
    await settings.set('playerEngine', 'video');
    await settings.set('render', 'texture');
    await settings.set('tunnel', true);
    expect(settings.get('render')).toBe('surface');
    await settings.set('render', 'texture');
    expect(settings.get('tunnel')).toBe(false);
  });

  it.each<[string, string]>([
    ['android', 'surface'],
    ['ios', 'texture'],
  ])("links tunnelling for 'auto' on %s", async (os, render) => {
    const original = Platform.OS;
    Platform.OS = os as typeof Platform.OS;
    try {
      const settings = createSettingsStore(new MemoryStore());
      await settings.set('render', 'texture');
      await settings.set('tunnel', true);
      expect(settings.get('playerEngine')).toBe('auto');
      expect(settings.get('render')).toBe(render);
    } finally {
      Platform.OS = original;
    }
  });
});

describe('subscriptions', () => {
  it('notifies all-settings and per-key listeners until unsubscribed', async () => {
    const settings = createSettingsStore(new MemoryStore());
    const all = jest.fn();
    const engine = jest.fn();
    const unsubscribeAll = settings.subscribe(all);
    const unsubscribeEngine = settings.subscribeKey('playerEngine', engine);

    await settings.set('playerEngine', 'mpv');
    await settings.set('airplay', false);
    await settings.set('airplay', false);

    expect(all).toHaveBeenCalledTimes(2);
    expect(all).toHaveBeenLastCalledWith(settings.getSettings(), ['airplay']);
    expect(engine).toHaveBeenCalledTimes(1);
    expect(engine).toHaveBeenCalledWith('mpv');

    unsubscribeAll();
    unsubscribeEngine();
    await settings.set('playerEngine', 'video');
    expect(all).toHaveBeenCalledTimes(2);
    expect(engine).toHaveBeenCalledTimes(1);
  });

  it('notifies changed keys on load', async () => {
    const store = new MemoryStore();
    await store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ decode: 'soft' }));
    const settings = createSettingsStore(store);
    const decode = jest.fn();
    settings.subscribeKey('decode', decode);
    await settings.loadSettings();
    expect(decode).toHaveBeenCalledWith('soft');
  });

  it('covers every schema key with a default', () => {
    const defaults = defaultSettings();
    for (const key of SETTING_KEYS) expect(defaults[key]).toBeDefined();
  });
});
