import { JarSpider, type JarProxyResult, type JarSpiderNative } from '../../../modules/jarspider';
import { findProviderFactory, getProvider } from '../../core/provider';
import { getRecentJsSpider, JsSpiderProvider, jsSpiderProviderFactory, type SpiderProxyResponse } from '../../spider';
import type { LanContext } from '../context';
import { serverError } from '../reply';
import type { LanProcess, LanResponse } from '../types';

const INVALID_RESPONSE = 'Invalid proxy response';

function fromJar(result: JarProxyResult | null): LanResponse | null {
  if (!result) return null;
  const headers = result.mime ? { 'Content-Type': result.mime, ...result.headers } : { ...result.headers };
  return { status: result.status, headers, body: result.body, bodyEncoding: 'base64' };
}

const reply = (response: SpiderProxyResponse | LanResponse | null): LanResponse => response ?? serverError(INVALID_RESPONSE);

/**
 * server/process/Proxy.java with BaseLoader.proxy routing for what the native
 * httpd fast path leaves to JS: `siteKey` of a JS spider site -> that spider,
 * `do=js` -> the recent JS spider, anything else -> JarSpider.proxy (null off
 * Android). Params are query + form + request headers (lower-case names).
 */
export function proxyProcess(ctx: LanContext, jar: JarSpiderNative | null = JarSpider): LanProcess {
  function jsSpider(key: string): JsSpiderProvider | undefined {
    const site = ctx.bootstrap.getSnapshot().config?.sites.find((item) => item.key === key);
    if (!site || findProviderFactory(site)?.id !== jsSpiderProviderFactory.id) return undefined;
    const provider = getProvider(site);
    return provider instanceof JsSpiderProvider ? provider : undefined;
  }

  return {
    matches: (path) => path.startsWith('/proxy'),
    async handle(req, params) {
      const all = { ...params, ...req.headers };
      if (all.siteKey !== undefined) {
        const spider = jsSpider(all.siteKey);
        if (spider) return reply(await spider.proxy(all));
      } else if (all.do === 'js') {
        return reply((await getRecentJsSpider()?.proxy(all)) ?? null);
      }
      return reply(jar ? fromJar(await jar.proxy(JSON.stringify(all))) : null);
    },
  };
}
