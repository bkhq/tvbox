import type { Live } from '../../core/types';
import { createPlaybackControllerHub, INACTIVE_SNAPSHOT, type PlaybackHost } from '../../player/controller';
import { createLanPlayer, createLanSources } from '../playerAdapter';

function fakeHost(): PlaybackHost & { calls: unknown[][] } {
  const calls: unknown[][] = [];
  const record =
    (name: string) =>
    (...args: unknown[]) =>
      void calls.push([name, ...args]);
  return {
    calls,
    getState: () => ({ ...INACTIVE_SNAPSHOT, active: true, playing: true, title: '第1集', position: 5000, duration: 60_000, speed: 1.5, url: 'https://a/b.m3u8', repeat: true, status: 'playing' }),
    subscribe: () => () => undefined,
    play: record('play'),
    pause: record('pause'),
    stop: record('stop'),
    prev: record('prev'),
    next: record('next'),
    repeat: record('repeat'),
    replay: record('replay'),
    seekTo: record('seekTo'),
    setSpeed: record('setSpeed'),
    playUrl: record('playUrl'),
  };
}

const live = (name: string) => ({ name }) as Live;

describe('createLanPlayer', () => {
  it('reports the controller state in LanPlayerState shape', () => {
    const hub = createPlaybackControllerHub();
    const player = createLanPlayer(hub.controller);
    expect(player.getState()).toEqual({ active: false, playing: false, title: '', position: 0, duration: 0, speed: 1, url: undefined });
    hub.attachPlaybackHost(fakeHost());
    expect(player.getState()).toEqual({
      active: true,
      playing: true,
      title: '第1集',
      position: 5000,
      duration: 60_000,
      speed: 1.5,
      url: 'https://a/b.m3u8',
    });
  });

  it('forwards every command to the attached host', () => {
    const hub = createPlaybackControllerHub();
    const host = fakeHost();
    hub.attachPlaybackHost(host);
    const player = createLanPlayer(hub.controller);
    player.play();
    player.pause();
    player.stop();
    player.prev();
    player.next();
    player.repeat();
    player.replay();
    player.seekTo(1000);
    player.setSpeed(2);
    player.playUrl('https://a/c.mp4', { title: '投屏', position: 3000 });
    expect(host.calls).toEqual([
      ['play'],
      ['pause'],
      ['stop'],
      ['prev'],
      ['next'],
      ['repeat'],
      ['replay'],
      ['seekTo', 1000],
      ['setSpeed', 2],
      ['playUrl', { url: 'https://a/c.mp4', title: '投屏', position: 3000 }],
    ]);
  });
});

describe('createLanSources', () => {
  it('lists the live sources and the selected one after a refresh', async () => {
    const sources = createLanSources({ load: async () => ({ lives: [live('A'), live('B')], home: live('B') }) });
    expect(sources.lives()).toEqual([]);
    await sources.refresh();
    expect(sources.lives()).toEqual([
      { key: 'A', name: 'A' },
      { key: 'B', name: 'B' },
    ]);
    expect(sources.currentLive()).toBe('B');
  });

  it('selects a known live source and saves it as home', async () => {
    const saveHome = jest.fn(async () => undefined);
    const sources = createLanSources({ load: async () => ({ lives: [live('A'), live('B')], home: live('A') }), saveHome });
    await sources.refresh();
    expect(sources.setLive('C')).toBe(false);
    expect(sources.setLive('B')).toBe(true);
    expect(sources.currentLive()).toBe('B');
    expect(saveHome).toHaveBeenCalledWith('B');
  });

  it('keeps a selection made while a refresh is in flight', async () => {
    const results: ((value: { lives: Live[]; home?: Live }) => void)[] = [];
    const sources = createLanSources({ load: () => new Promise((resolve) => results.push(resolve)), saveHome: async () => undefined });
    const first = sources.refresh();
    results[0]!({ lives: [live('A'), live('B')], home: live('A') });
    await first;
    const second = sources.refresh();
    expect(sources.setLive('B')).toBe(true);
    results[1]!({ lives: [live('A'), live('B')], home: live('A') });
    await second;
    expect(sources.currentLive()).toBe('B');
  });

  it('has no parsers', () => {
    const sources = createLanSources({ load: async () => ({ lives: [] }) });
    expect(sources.parses()).toEqual([]);
    expect(sources.currentParse()).toBe('');
    expect(sources.setParse('x')).toBe(false);
  });
});
