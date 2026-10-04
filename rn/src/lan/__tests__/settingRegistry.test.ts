import { Platform } from 'react-native';
import { createSettingsStore } from '../../core/settings/settings';
import { MemoryStore } from '../../core/storage/keyValueStore';
import type { Doh } from '../../core/types';
import { bodyJson, setup } from '../__fixtures__/fakes';
import { createSettingRegistry, dohList, type SettingGroupJson } from '../settingRegistry';

function registry(configDoh: Doh[] = []) {
  const settings = createSettingsStore(new MemoryStore());
  return { settings, registry: createSettingRegistry({ settings, configDoh: () => configDoh }) };
}

const keysOf = (groups: SettingGroupJson[]) => groups.map((group) => [group.key, group.items.map((item) => item.key)]);
const itemOf = (groups: SettingGroupJson[], key: string) => groups.flatMap((group) => group.items).find((item) => item.key === key);

describe('settingRegistry.toJson', () => {
  it('lists visible items by group in screen order for the exo engine', async () => {
    const { settings, registry: reg } = registry();
    await settings.set('playerEngine', 'video');
    expect(keysOf(reg.toJson())).toEqual([
      ['general', ['incognito', 'doh', 'airplay', 'airplay_name']],
      ['player', ['engine', 'render', 'scale', 'background', 'buffer', 'adblock', 'ua']],
      ['speed', ['speed', 'long_press', 'skip_silence']],
      ['decode', ['tunnel', 'audio_pass_through', 'audio_prefer', 'video_prefer', 'aac']],
      ['preload', ['preload']],
      ['live', ['live_change', 'live_invert', 'live_across', 'live_boot']],
    ]);
  });

  it('resolves the auto engine to the platform default (mpv on iOS)', () => {
    const groups = registry().registry.toJson();
    expect(Platform.OS).toBe('ios');
    expect(itemOf(groups, 'engine')?.value).toBe(1);
    expect(itemOf(groups, 'mpv_gpu_next')).toBeDefined();
    expect(itemOf(groups, 'tunnel')).toBeUndefined();
  });

  it('describes each type like the Java registry', async () => {
    const { settings, registry: reg } = registry();
    await settings.set('playerEngine', 'video');
    const groups = reg.toJson();
    expect(itemOf(groups, 'incognito')).toEqual({ key: 'incognito', label: '无痕模式', type: 'bool', value: false });
    expect(itemOf(groups, 'engine')).toEqual({ key: 'engine', label: '播放引擎', type: 'enum', value: 0, options: ['EXO', 'MPV'] });
    expect(itemOf(groups, 'scale')).toMatchObject({ value: 0, options: ['原始', '16:9', '4:3', '填充', '裁剪'] });
    expect(itemOf(groups, 'speed')).toEqual({ key: 'speed', label: '播放速度', type: 'number', value: 1, min: 0.1, max: 5, step: 0.05 });
    expect(itemOf(groups, 'ua')).toEqual({ key: 'ua', label: 'User-Agent', type: 'text', value: '' });
    expect(itemOf(groups, 'doh')).toMatchObject({ type: 'enum', value: 0, options: ['系统', '腾讯', '阿里', '360'] });
  });

  it('switches exo-only items for mpv items when the engine is mpv', async () => {
    const { settings, registry: reg } = registry();
    await settings.set('playerEngine', 'mpv');
    const player = keysOf(reg.toJson()).find(([key]) => key === 'player');
    expect(player?.[1]).toEqual(['engine', 'render', 'scale', 'background', 'mpv_gpu_next', 'mpv_vulkan', 'ua']);
    expect(itemOf(reg.toJson(), 'engine')?.value).toBe(1);
    expect(itemOf(reg.toJson(), 'tunnel')).toBeUndefined();
  });

  it('shows preload details only when preload is on, exo-only ones only on exo', async () => {
    const { settings, registry: reg } = registry();
    await settings.set('playerEngine', 'video');
    await settings.set('preload', true);
    expect(keysOf(reg.toJson()).find(([key]) => key === 'preload')?.[1]).toEqual([
      'preload',
      'preload_next',
      'preload_threads',
      'preload_size',
      'preload_time',
    ]);
    expect(itemOf(reg.toJson(), 'preload_size')).toMatchObject({ value: 128, min: 128, max: 4096, step: 128 });
    await settings.set('playerEngine', 'mpv');
    expect(keysOf(reg.toJson()).find(([key]) => key === 'preload')?.[1]).toEqual(['preload', 'preload_time']);
  });

  it('hides the AirPlay name when AirPlay is off', async () => {
    const { settings, registry: reg } = registry();
    await settings.set('airplay', false);
    expect(itemOf(reg.toJson(), 'airplay_name')).toBeUndefined();
  });

  it('appends config doh entries, replacing built-ins with the same url', () => {
    const custom = { name: 'Custom', url: 'https://doh.pub/dns-query', ips: ['1.2.3.4'] };
    expect(dohList([custom]).map((doh) => doh.name)).toEqual(['系统', '阿里', '360', 'Custom']);
  });
});

describe('settingRegistry.set', () => {
  it('converts each type onto the settings store', async () => {
    const { settings, registry: reg } = registry();
    await reg.set('incognito', 'true');
    await reg.set('engine', '1');
    await reg.set('scale', '3');
    await reg.set('speed', '1.25');
    await reg.set('buffer', '4.9');
    await reg.set('airplay_name', '  Living room  ');
    await reg.set('live_boot', 'true');
    expect(settings.getSettings()).toMatchObject({
      incognito: true,
      playerEngine: 'mpv',
      scale: 3,
      speedPlayback: 1.25,
      buffer: 4,
      airplayName: 'Living room',
      bootLive: true,
    });
  });

  it('stores the selected doh as JSON and reads its index back', async () => {
    const { settings, registry: reg } = registry();
    await reg.set('doh', '2');
    expect(JSON.parse(settings.get('doh'))).toEqual({ name: '阿里', url: 'https://dns.alidns.com/dns-query' });
    expect(itemOf(reg.toJson(), 'doh')?.value).toBe(2);
  });

  it('resolves false for an unknown key', async () => {
    await expect(registry().registry.set('danmaku_load', 'true')).resolves.toBe(false);
  });

  it.each([
    ['incognito', '1'],
    ['engine', '2'],
    ['engine', '-1'],
    ['engine', 'x'],
    ['doh', '4'],
    ['speed', '5.5'],
    ['long_press', '1'],
    ['buffer', ''],
    ['preload_time', 'abc'],
  ])('rejects %s=%s', async (key, value) => {
    await expect(registry().registry.set(key, value)).rejects.toThrow(`Invalid value for ${key}`);
  });
});

describe('/api/setting', () => {
  it('applies a value and reports it in /api/state', async () => {
    const { call, settings } = await setup();
    await settings.set('playerEngine', 'video');
    expect(await call('/api/setting', { key: 'adblock', value: 'false' })).toMatchObject({ status: 200, body: 'OK' });
    expect(settings.get('adblock')).toBe(false);
    const state = bodyJson(await call('/api/state'));
    expect(itemOf(state.settings as SettingGroupJson[], 'adblock')?.value).toBe(false);
  });

  it('answers 400 for unknown keys and invalid values', async () => {
    const { call } = await setup();
    expect(await call('/api/setting', { key: 'nope', value: '1' })).toMatchObject({ status: 400, body: 'Unknown key' });
    expect(await call('/api/setting', { key: 'buffer', value: '11' })).toMatchObject({
      status: 400,
      body: 'Invalid value for buffer',
    });
  });
});
