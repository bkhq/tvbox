import type { AirPlayCastEvent, AirPlayModule } from '../../../../modules/airplay';
import { createSettingsStore, type SettingsStore } from '../../../core/settings';
import { MemoryStore } from '../../../core/storage/keyValueStore';
import type { LanPlayer, LanPlayerState } from '../../ports';
import { startAirPlay } from '../airplay';

function mockModule(supported = true) {
  let listener: ((event: AirPlayCastEvent) => void) | null = null;
  const remove = jest.fn(() => {
    listener = null;
  });
  const module = {
    isSupported: jest.fn(() => supported),
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    addCastListener: jest.fn((l: (event: AirPlayCastEvent) => void) => {
      listener = l;
      return { remove };
    }),
    updatePlayback: jest.fn(),
  } satisfies AirPlayModule;
  const emit = (event: AirPlayCastEvent) => listener?.(event);
  return { module, emit, remove };
}

function mockPlayer(state: Partial<LanPlayerState> = {}) {
  const current: LanPlayerState = {
    active: true,
    playing: true,
    title: '',
    position: 0,
    duration: 0,
    speed: 1,
    ...state,
  };
  const player = {
    state: current,
    getState: jest.fn(() => ({ ...current })),
    play: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    prev: jest.fn(),
    next: jest.fn(),
    repeat: jest.fn(),
    replay: jest.fn(),
    seekTo: jest.fn(),
    setSpeed: jest.fn(),
    playUrl: jest.fn(),
  } satisfies LanPlayer & { state: LanPlayerState };
  return player;
}

describe('startAirPlay', () => {
  let settings: SettingsStore;

  beforeEach(() => {
    jest.useFakeTimers();
    settings = createSettingsStore(new MemoryStore());
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is inert when the module is unsupported', () => {
    const { module } = mockModule(false);
    const stop = startAirPlay({ module, getPlayer: () => null, settings });
    expect(module.start).not.toHaveBeenCalled();
    expect(module.addCastListener).not.toHaveBeenCalled();
    stop();
    expect(module.stop).not.toHaveBeenCalled();
  });

  it('is inert with the default module outside Android', () => {
    expect(() => startAirPlay({ getPlayer: () => null, settings })()).not.toThrow();
  });

  it('starts with the default name when the setting is empty', () => {
    const { module } = mockModule();
    startAirPlay({ module, getPlayer: () => null, settings });
    expect(module.start).toHaveBeenCalledWith({ name: 'tvbox' });
  });

  it('starts with the configured name', async () => {
    await settings.set('airplayName', 'Living room');
    const { module } = mockModule();
    startAirPlay({ module, getPlayer: () => null, settings });
    expect(module.start).toHaveBeenCalledWith({ name: 'Living room' });
  });

  it('does not start when disabled, and starts once enabled', async () => {
    await settings.set('airplay', false);
    const { module } = mockModule();
    startAirPlay({ module, getPlayer: () => null, settings });
    expect(module.start).not.toHaveBeenCalled();
    await settings.set('airplay', true);
    expect(module.start).toHaveBeenCalledTimes(1);
  });

  it('restarts on name change and stops on toggle off', async () => {
    const { module } = mockModule();
    startAirPlay({ module, getPlayer: () => null, settings });
    await settings.set('airplayName', 'Bedroom');
    expect(module.start).toHaveBeenLastCalledWith({ name: 'Bedroom' });
    expect(module.start).toHaveBeenCalledTimes(2);
    await settings.set('airplay', false);
    expect(module.stop).toHaveBeenCalledTimes(1);
    await settings.set('airplayName', 'Kitchen');
    expect(module.start).toHaveBeenCalledTimes(2);
  });

  it('stops the receiver and unsubscribes on dispose', async () => {
    const { module, remove } = mockModule();
    const stop = startAirPlay({ module, getPlayer: () => null, settings });
    stop();
    expect(module.stop).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalled();
    await settings.set('airplayName', 'Other');
    expect(module.start).toHaveBeenCalledTimes(1);
  });

  it('maps cast events to the player', () => {
    const { module, emit } = mockModule();
    const player = mockPlayer();
    startAirPlay({ module, getPlayer: () => player, settings });

    emit({ type: 'play', url: 'http://127.0.0.1:7000/a.m3u8', position: 5000 });
    expect(player.playUrl).toHaveBeenCalledWith('http://127.0.0.1:7000/a.m3u8', { position: 5000 });
    emit({ type: 'pause' });
    expect(player.pause).toHaveBeenCalled();
    emit({ type: 'resume' });
    expect(player.play).toHaveBeenCalled();
    emit({ type: 'seek', position: 42000 });
    expect(player.seekTo).toHaveBeenCalledWith(42000);
    emit({ type: 'stop' });
    expect(player.stop).toHaveBeenCalled();
  });

  it('ignores cast events without a player', () => {
    const { module, emit } = mockModule();
    startAirPlay({ module, getPlayer: () => null, settings });
    expect(() => emit({ type: 'play', url: 'http://x/a.m3u8', position: 0 })).not.toThrow();
    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).not.toHaveBeenCalled();
  });

  it('pushes player state every second while a cast is active', () => {
    const { module, emit } = mockModule();
    const player = mockPlayer({ position: 1000, duration: 60000, playing: true, speed: 1.5 });
    startAirPlay({ module, getPlayer: () => player, settings });

    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).not.toHaveBeenCalled();

    emit({ type: 'play', url: 'http://x/a.m3u8', position: 0 });
    expect(module.updatePlayback).toHaveBeenLastCalledWith({ position: 1000, duration: 60000, playing: true, rate: 1.5 });

    player.state.position = 2000;
    player.state.playing = false;
    jest.advanceTimersByTime(1000);
    expect(module.updatePlayback).toHaveBeenCalledTimes(2);
    expect(module.updatePlayback).toHaveBeenLastCalledWith({ position: 2000, duration: 60000, playing: false, rate: 1.5 });

    emit({ type: 'stop' });
    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).toHaveBeenCalledTimes(2);
  });

  it('stops pushing state when the receiver is turned off', async () => {
    const { module, emit } = mockModule();
    const player = mockPlayer();
    startAirPlay({ module, getPlayer: () => player, settings });
    emit({ type: 'play', url: 'http://x/a.m3u8', position: 0 });
    await settings.set('airplay', false);
    const calls = module.updatePlayback.mock.calls.length;
    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).toHaveBeenCalledTimes(calls);
  });
});
