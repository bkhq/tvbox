import { supportedSites } from '../../core/config/vodConfig';
import type { LanContext } from '../context';
import { badRequest, notFound, ok } from '../reply';
import type { LanEndpoint } from '../types';

const UNSUPPORTED = '不支持';

/** SourceApi: home site, live source, parser, cache and backup. */
export const sourceApi =
  (ctx: LanContext): LanEndpoint =>
  async (_req, params) => {
    const value = params.value ?? '';
    const sources = ctx.ports().sources;
    switch (params.do) {
      case 'site': {
        const config = ctx.bootstrap.getSnapshot().config;
        const site = config ? supportedSites(config).find((item) => item.key === value) : undefined;
        if (!site) return notFound('site not found');
        await ctx.settings.set('homeSiteKey', site.key);
        return ok();
      }
      case 'live':
        return sources?.setLive(value) ? ok() : notFound('live not found');
      case 'parse':
        return sources?.setParse(value) ? ok() : notFound('parse not found');
      case 'cache':
        if (!sources?.clearCache) return badRequest(UNSUPPORTED);
        await sources.clearCache();
        return ok();
      case 'backup':
        if (!sources?.backup) return badRequest(UNSUPPORTED);
        void sources.backup().catch(() => false);
        return ok();
      default:
        return badRequest('Unknown do');
    }
  };
