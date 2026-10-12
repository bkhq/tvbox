import type { DlnaCastEvent, DlnaModule } from '../../../../modules/dlna';
import type { LanPlayer, LanPlayerState } from '../../ports';
import { startDlna } from '../dlna';

function mockModule(supported = true) {
  let listener: ((event: DlnaCastEvent) => void) | null = null;
  const remove = jest.fn(() => {
    listener = null;
  });
  const module = {
    isSupported: jest.fn(() => supported),
    start: jest.fn(async () => {}),
    stop: jest.fn(async () => {}),
    addCastListener: jest.fn((l: (event: DlnaCastEvent) => void) => {
      listener = l;
      return { remove };
    }),
    updatePlayback: jest.fn(),
  } satisfies DlnaModule;
  const emit = (event: DlnaCastEvent) => listener?.(event);
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

const URL = 'http://192.168.1.2/video.mp4';

describe('startDlna', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('is inert when the module is unsupported', () => {
    const { module } = mockModule(false);
    const name = jest.fn(() => 'TV');
    const stop = startDlna({ module, getPlayer: () => null, name });
    expect(module.start).not.toHaveBeenCalled();
    expect(module.addCastListener).not.toHaveBeenCalled();
    expect(name).not.toHaveBeenCalled();
    stop();
    expect(module.stop).not.toHaveBeenCalled();
  });

  it('is inert with the default module outside Android', () => {
    expect(() => startDlna({ getPlayer: () => null, name: () => '' })()).not.toThrow();
  });

  it('starts under the trimmed name and stops everything', () => {
    const { module, remove } = mockModule();
    const stop = startDlna({ module, getPlayer: () => null, name: () => '  客厅  ' });
    expect(module.start).toHaveBeenCalledWith({ name: '客厅' });
    expect(module.addCastListener).toHaveBeenCalledTimes(1);
    stop();
    expect(remove).toHaveBeenCalled();
    expect(module.stop).toHaveBeenCalledTimes(1);
  });

  it('passes an empty name so the native side uses the device name', () => {
    const { module } = mockModule();
    startDlna({ module, getPlayer: () => null, name: () => ' ' });
    expect(module.start).toHaveBeenCalledWith({ name: '' });
  });

  it('plays casts with title, position and headers', () => {
    const { module, emit } = mockModule();
    const player = mockPlayer();
    startDlna({ module, getPlayer: () => player, name: () => '' });
    emit({ type: 'play', url: URL, title: '电影', position: 5000, headers: { Referer: 'http://a' } });
    expect(player.playUrl).toHaveBeenCalledWith(URL, { title: '电影', position: 5000, headers: { Referer: 'http://a' } });
  });

  it('maps transport events to the player', () => {
    const { module, emit } = mockModule();
    const player = mockPlayer();
    startDlna({ module, getPlayer: () => player, name: () => '' });
    emit({ type: 'pause' });
    expect(player.pause).toHaveBeenCalled();
    emit({ type: 'resume' });
    expect(player.play).toHaveBeenCalled();
    emit({ type: 'seek', position: 61_500 });
    expect(player.seekTo).toHaveBeenCalledWith(61_500);
    emit({ type: 'stop' });
    expect(player.stop).toHaveBeenCalled();
  });

  it('forwards volume and mute to the optional callback', () => {
    const { module, emit } = mockModule();
    const player = mockPlayer();
    const onVolume = jest.fn();
    startDlna({ module, getPlayer: () => player, name: () => '', onVolume });
    emit({ type: 'volume', volume: 40 });
    emit({ type: 'mute', mute: true });
    expect(onVolume).toHaveBeenNthCalledWith(1, { type: 'volume', volume: 40 });
    expect(onVolume).toHaveBeenNthCalledWith(2, { type: 'mute', mute: true });
    expect(player.play).not.toHaveBeenCalled();
  });

  it('ignores volume without a callback and events without a player', () => {
    const { module, emit } = mockModule();
    startDlna({ module, getPlayer: () => null, name: () => '' });
    expect(() => {
      emit({ type: 'volume', volume: 10 });
      emit({ type: 'mute', mute: false });
      emit({ type: 'play', url: URL });
      emit({ type: 'stop' });
    }).not.toThrow();
    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).not.toHaveBeenCalled();
  });

  it('pushes the player state every second while a cast is active', () => {
    const { module, emit } = mockModule();
    const player = mockPlayer({ position: 1000, duration: 60_000 });
    startDlna({ module, getPlayer: () => player, name: () => '' });

    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).not.toHaveBeenCalled();

    emit({ type: 'play', url: URL });
    jest.advanceTimersByTime(1000);
    expect(module.updatePlayback).toHaveBeenLastCalledWith({ position: 1000, duration: 60_000, playing: true, ended: false });

    player.state.position = 2000;
    player.state.playing = false;
    jest.advanceTimersByTime(1000);
    expect(module.updatePlayback).toHaveBeenLastCalledWith({ position: 2000, duration: 60_000, playing: false, ended: false });
    expect(module.updatePlayback).toHaveBeenCalledTimes(2);

    emit({ type: 'stop' });
    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).toHaveBeenCalledTimes(2);
  });

  it('reports the end of the media once and stops pushing', () => {
    const { module, emit } = mockModule();
    const player = mockPlayer({ position: 59_500, duration: 60_000, playing: false });
    startDlna({ module, getPlayer: () => player, name: () => '' });
    emit({ type: 'play', url: URL });
    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).toHaveBeenCalledTimes(1);
    expect(module.updatePlayback).toHaveBeenLastCalledWith({ position: 59_500, duration: 60_000, playing: false, ended: true });
  });

  it('reports a closed player as ended only after it was active', () => {
    const { module, emit } = mockModule();
    const player = mockPlayer({ active: false, playing: false, position: 0, duration: 0 });
    startDlna({ module, getPlayer: () => player, name: () => '' });
    emit({ type: 'play', url: URL });

    jest.advanceTimersByTime(1000);
    expect(module.updatePlayback).toHaveBeenLastCalledWith({ position: 0, duration: 0, playing: false, ended: false });

    Object.assign(player.state, { active: true, playing: true, position: 3000, duration: 60_000 });
    jest.advanceTimersByTime(1000);
    expect(module.updatePlayback).toHaveBeenLastCalledWith({ position: 3000, duration: 60_000, playing: true, ended: false });

    Object.assign(player.state, { active: false });
    jest.advanceTimersByTime(1000);
    expect(module.updatePlayback).toHaveBeenLastCalledWith({ position: 3000, duration: 60_000, playing: false, ended: true });

    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).toHaveBeenCalledTimes(3);
  });

  it('stops pushing when stopped', () => {
    const { module, emit } = mockModule();
    const player = mockPlayer();
    const stop = startDlna({ module, getPlayer: () => player, name: () => '' });
    emit({ type: 'play', url: URL });
    stop();
    jest.advanceTimersByTime(3000);
    expect(module.updatePlayback).not.toHaveBeenCalled();
  });
});
