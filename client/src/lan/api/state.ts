import { supportedSites } from '../../core/config/vodConfig';
import type { ConfigRepository } from '../../core/storage/configs';
import type { LanContext } from '../context';
import { tokenOf } from '../pairing';
import type { LanPorts } from '../ports';
import { json } from '../reply';
import type { LanEndpoint } from '../types';
import { devicesJson } from './pair';

async function configs(repository: ConfigRepository) {
  const [items, active] = await Promise.all([repository.list(), repository.getActive()]);
  return { current: active?.url ?? '', items: items.map(({ url, name, time }) => ({ url, name, time })) };
}

/** StateApi.player: only `active` unless something is playing. */
export function playerJson(ports: LanPorts) {
  const state = ports.player?.getState();
  if (!state?.active) return { active: false };
  return {
    active: true,
    playing: state.playing,
    title: state.title,
    position: Math.max(0, state.position),
    duration: Math.max(0, state.duration),
    speed: state.speed,
  };
}

/** SourceApi.toJson: sites of the active VOD config, lives and parses from the sources port. */
export function sourcesJson(ctx: LanContext, ports: LanPorts) {
  const config = ctx.bootstrap.getSnapshot().config;
  const sites = config ? supportedSites(config).map((site) => ({ key: site.key, name: site.name })) : [];
  const sources = ports.sources;
  return {
    sites,
    site: ctx.settings.get('homeSiteKey') || config?.home?.key || '',
    lives: sources?.lives() ?? [],
    live: sources?.currentLive() ?? '',
    parses: sources?.parses() ?? [],
    parse: sources?.currentParse() ?? '',
  };
}

function enrollJson(ctx: LanContext) {
  const link = ctx.serverLink?.();
  if (!link?.isEnabled()) return { available: false, state: 'off', code: '' };
  const snapshot = link.getSnapshot();
  return { available: true, state: snapshot.state.toLowerCase(), code: snapshot.code };
}

export const stateApi =
  (ctx: LanContext): LanEndpoint =>
  async (req, params) => {
    const ports = ctx.ports();
    if (params.only === 'player') return json({ player: playerJson(ports) });
    const env = ports.env;
    const [vod, live, cache] = await Promise.all([
      configs(ctx.configs.vod),
      configs(ctx.configs.live),
      ports.sources?.cacheSize?.() ?? Promise.resolve('0 B'),
    ]);
    return json({
      version: env?.version ?? '',
      address: env?.address() ?? '',
      token: tokenOf(req) ?? '',
      devices: devicesJson(ctx),
      vod,
      live,
      wall: { current: '', items: [] },
      settings: ctx.settingsProvider(),
      sources: sourcesJson(ctx, ports),
      cache,
      enroll: enrollJson(ctx),
      player: playerJson(ports),
    });
  };
