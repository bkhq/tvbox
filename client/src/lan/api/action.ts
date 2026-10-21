import type { LanContext } from '../context';
import type { LanPorts } from '../ports';
import { badRequest, json, ok } from '../reply';
import type { LanEndpoint, LanProcess } from '../types';

/** ActionApi push: play a url on the TV. */
export const pushApi =
  (ctx: LanContext): LanEndpoint =>
  (_req, params) => {
    const url = params.url ?? '';
    if (!url) return badRequest('url required');
    const player = ctx.ports().player;
    if (!player) return badRequest('player not available');
    player.playUrl(url);
    return ok();
  };

/** Media.build: 3 playing, 2 paused/ready, 1 idle. */
export function mediaJson(ports: LanPorts) {
  const state = ports.player?.getState();
  if (!state) return {};
  return {
    state: state.playing ? 3 : state.active ? 2 : 1,
    speed: state.speed,
    duration: state.duration,
    position: state.position,
    url: state.url ?? '',
    title: state.title,
    artist: '',
    artwork: state.artwork ?? '',
  };
}

/** Media process: player state for /media*, unprotected as in Java. */
export const mediaProcess = (ctx: LanContext): LanProcess => ({
  matches: (path) => path.startsWith('/media'),
  handle: () => json(mediaJson(ctx.ports())),
});
