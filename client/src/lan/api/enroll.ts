import type { LanContext } from '../context';
import { badRequest, ok } from '../reply';
import type { LanEndpoint } from '../types';

/** EnrollApi: the server link actions of the TV dialog. */
export const enrollApi =
  (ctx: LanContext): LanEndpoint =>
  (_req, params) => {
    const link = ctx.serverLink?.();
    if (!link?.isEnabled()) return badRequest('server link not available in this build');
    switch (params.do) {
      case 'request':
        void link.request().catch(() => undefined);
        return ok();
      case 'refresh':
        void link.refresh().catch(() => undefined);
        return ok();
      case 'unlink':
        void link.unlink().catch(() => undefined);
        return ok();
      default:
        return badRequest('Unknown do');
    }
  };
