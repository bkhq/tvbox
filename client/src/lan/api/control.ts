import type { LanContext } from '../context';
import type { LanPlayer } from '../ports';
import { badRequest, ok } from '../reply';
import type { LanEndpoint } from '../types';

export const MIN_SPEED = 0.1;
export const MAX_SPEED = 5;

export type PlayerCommand = (player: LanPlayer) => void;

class InvalidValueError extends Error {
  constructor() {
    super('Invalid value');
  }
}

function parseInteger(value: string): number {
  const trimmed = value.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) throw new InvalidValueError();
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed)) throw new InvalidValueError();
  return parsed;
}

function parseSpeed(value: string): number {
  const speed = Number(value.trim());
  if (value.trim() === '' || !Number.isFinite(speed) || speed < MIN_SPEED || speed > MAX_SPEED) throw new InvalidValueError();
  return speed;
}

/**
 * PlayerCommand.of: values are parsed before anything reaches the player.
 * Returns null for an unknown command; throws "Invalid value" for a bad value.
 */
export function playerCommand(type: string, value: string): PlayerCommand | null {
  switch (type) {
    case 'play':
      return (player) => player.play();
    case 'pause':
      return (player) => player.pause();
    case 'toggle':
      return (player) => (player.getState().playing ? player.pause() : player.play());
    case 'stop':
      return (player) => player.stop();
    case 'prev':
      return (player) => player.prev();
    case 'next':
      return (player) => player.next();
    case 'repeat':
      return (player) => player.repeat();
    case 'replay':
      return (player) => player.replay();
    case 'seek': {
      const offset = parseInteger(value);
      return (player) => player.seekTo(Math.max(0, player.getState().position + offset));
    }
    case 'seekto': {
      const position = Math.max(0, parseInteger(value));
      return (player) => player.seekTo(position);
    }
    case 'speed': {
      const speed = parseSpeed(value);
      return (player) => player.setSpeed(speed);
    }
    default:
      return null;
  }
}

export const controlApi =
  (ctx: LanContext): LanEndpoint =>
  (_req, params) => {
    let command: PlayerCommand | null;
    try {
      command = playerCommand(params.do ?? '', params.value ?? '0');
    } catch (error) {
      if (error instanceof InvalidValueError) return badRequest(error.message);
      throw error;
    }
    if (!command) return badRequest('Unknown do');
    const player = ctx.ports().player;
    if (!player?.getState().active) return badRequest('player not running');
    command(player);
    return ok();
  };
