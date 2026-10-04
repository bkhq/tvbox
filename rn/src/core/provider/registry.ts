/**
 * Provider registry: factories register with a Site matcher; getProvider
 * returns one cached instance per site key. Later registrations win, so a
 * workstream can add a provider without editing this file.
 */

import type { Site } from '../types';
import { cmsProviderFactory } from './cms';
import type { ProviderContext, ProviderFactory, SiteProvider } from './types';

export class UnsupportedSiteError extends Error {
  constructor(readonly site: Pick<Site, 'key' | 'type' | 'api'>) {
    super(`Unsupported site "${site.key}" (type ${site.type}, api ${site.api})`);
    this.name = 'UnsupportedSiteError';
  }
}

const builtins: ProviderFactory[] = [cmsProviderFactory];
let factories: ProviderFactory[] = [...builtins];
const instances = new Map<string, SiteProvider>();

/** Registers a factory (replacing one with the same id); returns an unregister function. */
export function registerProvider(factory: ProviderFactory): () => void {
  factories = factories.filter((item) => item.id !== factory.id);
  factories.push(factory);
  return () => {
    factories = factories.filter((item) => item !== factory);
  };
}

export function findProviderFactory(site: Site): ProviderFactory | undefined {
  return [...factories].reverse().find((factory) => factory.match(site));
}

/** Cached provider for `site`; a different Site object under the same key (config reload) gets a fresh instance. */
export function getProvider(site: Site, ctx: ProviderContext = {}): SiteProvider {
  const cached = instances.get(site.key);
  if (cached && cached.site === site) return cached;
  const factory = findProviderFactory(site);
  if (!factory) throw new UnsupportedSiteError(site);
  if (cached) void cached.destroy?.();
  const provider = factory.create(site, ctx);
  instances.set(site.key, provider);
  return provider;
}

/** Destroys and drops all cached instances (e.g. after a config reload). */
export function clearProviders(): void {
  for (const provider of instances.values()) void provider.destroy?.();
  instances.clear();
}

/** Test helper: clears instances and restores the built-in factories. */
export function resetProviderRegistry(): void {
  clearProviders();
  factories = [...builtins];
}
