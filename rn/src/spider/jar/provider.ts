/**
 * SiteProvider for type 3 "csp_" sites: runs a TVBox JAR spider through the
 * Android-only JarSpider native module (a port of JarLoader). Result handling
 * follows the type 3 branches of SiteApi.java, like JsSpiderProvider.
 */

import { JarSpider, type JarProxyResult, type JarSpiderNative } from '../../../modules/jarspider';
import { isJarSite } from '../../core/config/vodConfig';
import { applyTypes, parseJsonResult } from '../../core/provider/cms';
import type { ProviderFactory, SiteProvider } from '../../core/provider/types';
import type { Result, Site } from '../../core/types';
import { DEFAULT_SPIDER_TIMEOUT } from '../provider';
import { SpiderError, SpiderTimeoutError } from '../runtime';

/** Maps a native rejection (ERR_JARSPIDER_* CodedError) to SpiderError. */
export function toJarSpiderError(error: unknown): SpiderError {
  if (error instanceof SpiderError) return error;
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return new SpiderError(code === 'ERR_JARSPIDER_LOAD' ? 'ERR_SPIDER_LOAD' : 'ERR_SPIDER_RUNTIME', message);
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new SpiderTimeoutError(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pending destroySpider per site key, so a replacement provider never inits before the old spider is gone. */
const destroying = new Map<string, Promise<void>>();

export class JarSpiderProvider implements SiteProvider {
  private ready?: Promise<void>;
  private destroyed = false;

  constructor(
    readonly site: Site,
    private readonly native: JarSpiderNative,
  ) {}

  get timeout(): number {
    return this.site.timeout > 0 ? this.site.timeout : DEFAULT_SPIDER_TIMEOUT;
  }

  /** Lazy, memoised initSpider; a failed init is dropped so the next call retries. */
  private spider(): Promise<void> {
    if (this.destroyed) return Promise.reject(new SpiderError('ERR_SPIDER_DESTROYED', `Spider ${this.site.key} was destroyed`));
    if (!this.ready) {
      const { key, api, ext, jar = '' } = this.site;
      const ready = (destroying.get(key) ?? Promise.resolve())
        .then(() => this.native.initSpider(key, api, ext, jar))
        .catch((error: unknown) => {
          if (this.ready === ready) this.ready = undefined;
          throw toJarSpiderError(error);
        });
      this.ready = ready;
    }
    return this.ready;
  }

  private async raw(method: string, call: (native: JarSpiderNative) => Promise<string>): Promise<string> {
    const run = async () => {
      await this.spider();
      this.native.setRecent(this.site.jar ?? '');
      try {
        return await call(this.native);
      } catch (error) {
        throw toJarSpiderError(error);
      }
    };
    return withTimeout(run(), this.timeout, `${this.site.key}.${method}`);
  }

  private async call(method: string, call: (native: JarSpiderNative) => Promise<string>): Promise<Result> {
    return parseJsonResult(await this.raw(method, call));
  }

  /** Resolves once the spider has been created and `init` returned. */
  async init(): Promise<void> {
    await this.spider();
  }

  async home(filter: boolean): Promise<Result> {
    return applyTypes(this.site, await this.call('homeContent', (n) => n.homeContent(this.site.key, filter)));
  }

  homeVideo(): Promise<Result> {
    return this.call('homeVideoContent', (n) => n.homeVideoContent(this.site.key));
  }

  category(tid: string, page: string, filter: boolean, extend: Record<string, string>): Promise<Result> {
    return this.call('categoryContent', (n) => n.categoryContent(this.site.key, tid, page, filter, JSON.stringify(extend)));
  }

  detail(ids: string[]): Promise<Result> {
    return this.call('detailContent', (n) => n.detailContent(this.site.key, JSON.stringify(ids)));
  }

  search(key: string, quick: boolean, page = '1'): Promise<Result> {
    return this.call('searchContent', (n) => n.searchContent(this.site.key, key, quick, page));
  }

  /** SiteApi.playerContent: default flag, site header when the spider sets none, site key. */
  async player(flag: string, id: string, vipFlags: string[]): Promise<Result> {
    const result = await this.call('playerContent', (n) => n.playerContent(this.site.key, flag, id, JSON.stringify(vipFlags)));
    return {
      ...result,
      flag: result.flag === '' ? flag : result.flag,
      header: Object.keys(result.header).length === 0 ? { ...this.site.header } : result.header,
      key: this.site.key,
    };
  }

  /** spider.proxy(params) of this site (siteKey added); null when nothing handled it. */
  proxy(params: Record<string, string>): Promise<JarProxyResult | null> {
    return this.native.proxy(JSON.stringify({ ...params, siteKey: this.site.key }));
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    const ready = this.ready;
    this.ready = undefined;
    if (!ready) return;
    const { key } = this.site;
    const done = ready
      .then(() => this.native.destroySpider(key))
      .catch(() => undefined)
      .finally(() => {
        if (destroying.get(key) === done) destroying.delete(key);
      });
    destroying.set(key, done);
    await done;
  }
}

/** Factory for JAR sites; matches nothing when the native module is absent (iOS / tvOS, web, Jest). */
export function createJarSpiderProviderFactory(native: JarSpiderNative | null = JarSpider): ProviderFactory {
  return {
    id: 'jar-spider',
    match: (site) => native !== null && isJarSite(site),
    create: (site) => {
      if (!native) throw new SpiderError('ERR_SPIDER_RUNTIME', 'JarSpider native module is not available');
      return new JarSpiderProvider(site, native);
    },
  };
}
