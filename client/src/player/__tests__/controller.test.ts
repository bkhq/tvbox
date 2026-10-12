import { createPlaybackControllerHub, INACTIVE_SNAPSHOT, type PlaybackHost, type PlaybackSnapshot, type SnapshotListener } from '../controller';

function fakeHost(withPlayUrl = true) {
  const pushes = new Set<SnapshotListener>();
  let state: PlaybackSnapshot = { ...INACTIVE_SNAPSHOT, active: true, playing: true, title: 'T', status: 'playing' };
  const host = {
    play: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    prev: jest.fn(),
    next: jest.fn(),
    repeat: jest.fn(),
    replay: jest.fn(),
    seekTo: jest.fn(),
    setSpeed: jest.fn(),
    getState: () => state,
    subscribe: (push: SnapshotListener) => {
      pushes.add(push);
      return () => pushes.delete(push);
    },
    ...(withPlayUrl ? { playUrl: jest.fn() } : {}),
  } satisfies PlaybackHost;
  const push = (next: Partial<PlaybackSnapshot>) => {
    state = { ...state, ...next };
    for (const listener of pushes) listener(state);
  };
  return { host, push, pushes };
}

describe('playback controller', () => {
  it('is inactive with no-op controls when no host is attached', () => {
    const { controller } = createPlaybackControllerHub();
    expect(controller.getState()).toEqual(INACTIVE_SNAPSHOT);
    expect(() => {
      controller.play();
      controller.seekTo(10);
      controller.setSpeed(2);
    }).not.toThrow();
  });

  it('delegates commands to the attached host', () => {
    const hub = createPlaybackControllerHub();
    const { host } = fakeHost();
    hub.attachPlaybackHost(host);
    const { controller } = hub;
    controller.play();
    controller.pause();
    controller.stop();
    controller.prev();
    controller.next();
    controller.repeat();
    controller.replay();
    controller.seekTo(-5);
    controller.seekTo(1234);
    controller.setSpeed(9);
    controller.setSpeed(Number.NaN);
    for (const name of ['play', 'pause', 'stop', 'prev', 'next', 'repeat', 'replay'] as const) expect(host[name]).toHaveBeenCalledTimes(1);
    expect(host.seekTo.mock.calls).toEqual([[0], [1234]]);
    expect(host.setSpeed.mock.calls).toEqual([[5]]);
  });

  it('publishes host state pushes and goes inactive on detach', () => {
    const hub = createPlaybackControllerHub();
    const { host, push, pushes } = fakeHost();
    const listener = jest.fn();
    hub.controller.subscribe(listener);
    const detach = hub.attachPlaybackHost(host);
    expect(hub.controller.getState()).toMatchObject({ active: true, title: 'T' });
    push({ position: 5000, repeat: true });
    expect(listener).toHaveBeenLastCalledWith(expect.objectContaining({ position: 5000, repeat: true }));
    detach();
    expect(pushes.size).toBe(0);
    expect(hub.controller.getState()).toEqual(INACTIVE_SNAPSHOT);
    expect(listener).toHaveBeenLastCalledWith(INACTIVE_SNAPSHOT);
  });

  it('ignores a stale detach after another host attached', () => {
    const hub = createPlaybackControllerHub();
    const first = fakeHost();
    const second = fakeHost();
    const detachFirst = hub.attachPlaybackHost(first.host);
    hub.attachPlaybackHost(second.host);
    detachFirst();
    hub.controller.play();
    expect(second.host.play).toHaveBeenCalled();
    expect(first.host.play).not.toHaveBeenCalled();
  });

  it('opens the player for playUrl and delivers the queued request once a host attaches', () => {
    const hub = createPlaybackControllerHub();
    const opener = jest.fn();
    hub.controller.playUrl('http://queued', { title: 'Q' });
    expect(opener).not.toHaveBeenCalled();
    hub.setPlayerOpener(opener);
    expect(opener).toHaveBeenCalledWith({ url: 'http://queued', title: 'Q' });

    hub.controller.playUrl('http://cast', { position: 1000, headers: { Referer: 'r' } });
    expect(opener).toHaveBeenLastCalledWith({ url: 'http://cast', position: 1000, headers: { Referer: 'r' } });

    const { host } = fakeHost();
    hub.attachPlaybackHost(host);
    expect(host.playUrl).toHaveBeenCalledTimes(1);
    expect(host.playUrl).toHaveBeenCalledWith({ url: 'http://cast', position: 1000, headers: { Referer: 'r' } });

    hub.controller.playUrl('http://direct');
    expect(host.playUrl).toHaveBeenLastCalledWith({ url: 'http://direct' });
    expect(opener).toHaveBeenCalledTimes(2);
  });

  it('routes playUrl through the opener while a host without playUrl (Live) is attached', () => {
    const hub = createPlaybackControllerHub();
    const opener = jest.fn();
    hub.setPlayerOpener(opener);
    hub.attachPlaybackHost(fakeHost(false).host);
    hub.controller.playUrl('http://x');
    expect(opener).toHaveBeenCalledWith({ url: 'http://x' });
    const player = fakeHost();
    hub.attachPlaybackHost(player.host);
    expect(player.host.playUrl).toHaveBeenCalledWith({ url: 'http://x' });
  });
});
