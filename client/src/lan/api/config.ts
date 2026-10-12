import type { LanContext } from '../context';
import { badRequest, ok } from '../reply';
import type { LanEndpoint } from '../types';

const VOD = '0';
const LIVE = '1';
const WALL = '2';

/** ConfigApi: use or delete a saved VOD / live config; wallpapers are not supported. */
export const configApi =
  (ctx: LanContext): LanEndpoint =>
  async (_req, params) => {
    const type = (params.type ?? '').trim();
    if (type === WALL) return badRequest('wallpaper not supported');
    if (type !== VOD && type !== LIVE) return badRequest('Invalid type');
    const url = (params.url ?? '').trim();
    const name = (params.name ?? '').trim();
    if (!url) return badRequest('url required');
    const repository = type === VOD ? ctx.configs.vod : ctx.configs.live;
    switch (params.do) {
      case 'use':
        if (name) await repository.add({ url, name });
        if (type === VOD) {
          await ctx.bootstrap.addConfig(url);
        } else {
          await repository.add({ url });
          await repository.setActive(url);
        }
        return ok();
      case 'delete':
        if ((await repository.getActive())?.url === url) return badRequest('config in use');
        await repository.remove(url);
        return ok();
      default:
        return badRequest('Unknown do');
    }
  };
