import type { LanContext } from '../context';
import type { LanKey, LanVolume } from '../ports';
import { badRequest, ok } from '../reply';
import type { LanEndpoint } from '../types';

const KEYS: readonly LanKey[] = ['up', 'down', 'left', 'right', 'ok', 'back', 'menu'];
const VOLUMES: readonly LanVolume[] = ['up', 'down', 'mute'];

const NOT_FOREGROUND = 'the app is not in the foreground on the TV';

/** RemoteApi: D-pad keys and text go to the foreground screen, volume to the media stream. */
export const remoteApi =
  (ctx: LanContext): LanEndpoint =>
  async (_req, params) => {
    const value = params.value ?? '';
    const remote = ctx.ports().remote;
    switch (params.do ?? '') {
      case 'key': {
        const key = KEYS.find((item) => item === value);
        if (!key) return badRequest('Unknown key');
        return remote && (await remote.sendKey(key)) ? ok() : badRequest(NOT_FOREGROUND);
      }
      case 'text':
        if (!remote) return badRequest(NOT_FOREGROUND);
        return (await remote.sendText(value)) ? ok() : badRequest('no text field is focused on the TV');
      case 'volume': {
        const direction = VOLUMES.find((item) => item === value);
        if (!direction) return badRequest('Unknown volume');
        return remote && (await remote.adjustVolume(direction)) ? ok() : badRequest('volume not supported');
      }
      default:
        return badRequest('Unknown do');
    }
  };
