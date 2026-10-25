import { getAppConfig } from '../../core/appConfig';
import type { LanContext } from '../context';
import { forbidden, json, notFound, ok } from '../reply';
import type { LanEndpoint } from '../types';

export const pairApi =
  (ctx: LanContext): LanEndpoint =>
  async (req, params) => {
    const device = await ctx.pairing.pair(params.code, params.name, req.headers['user-agent'], req.remoteAddress);
    if (!device) return forbidden('wrong code');
    return json({ token: device.token, name: device.name });
  };

export const unpairApi =
  (ctx: LanContext): LanEndpoint =>
  async (_req, params) =>
    (await ctx.pairing.unpair(params.target ?? '')) ? ok() : notFound('device not found');

/** LinkApi: the worker entry the phone page passes a QR code's key through; '' without a worker. */
export const linkApi = (): LanEndpoint => async () => {
  const { workerUrl } = getAppConfig();
  return json({ via: workerUrl ? `${workerUrl}/link` : '' });
};

/** Paired devices as PairApi.devices lists them. */
export function devicesJson(ctx: LanContext) {
  return ctx.pairing.devices().map(({ token, name, agent, ip, time, last }) => ({ token, name, agent, ip, time, last }));
}
