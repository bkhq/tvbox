import { classifySite } from '../core/config/vodConfig';
import { registerProvider, type ProviderFactory } from '../core/provider';
import { JsSpiderProvider } from './provider';

export * from './prelude';
export * from './provider';
export * from './runtime';

/** Type 3 sites whose api is a `.js` file (the classifySite rule). */
export const jsSpiderProviderFactory: ProviderFactory = {
  id: 'js-spider',
  match: (site) => site.type === 3 && classifySite(site.type, site.api).supported,
  create: (site, ctx) => new JsSpiderProvider(site, ctx),
};

/** Registers the JS spider provider; returns the unregister function. Needs setSpiderRuntime() before sites are opened. */
export function registerJsSpiderProvider(): () => void {
  return registerProvider(jsSpiderProviderFactory);
}
