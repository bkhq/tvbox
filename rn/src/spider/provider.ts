/**
 * SiteProvider for type 3 sites with a `.js` api: runs a FongMi-format JS
 * spider in its own QuickJS context. Bootstrap follows
 * quickjs/.../crawler/Spider.java (createCtx, createObj, getExt); result
 * handling follows the type 3 branches of SiteApi.java.
 */

import { applyTypes, emptyResult, parseJsonResult } from '../core/provider/cms';
import type { ProviderContext, SiteProvider } from '../core/provider/types';
import { getText } from '../core/http';
import { isObject, normalizeResult, type Result, type Site } from '../core/types';
import {
  CRYPTO_FILENAME,
  CRYPTO_MODULE,
  ENTRY_FILENAME,
  PARSER_FILENAME,
  PARSER_MODULE,
  PRELUDE,
  PRELUDE_FILENAME,
  spiderEntry,
  usesCrypto,
  usesParser,
} from './prelude';
import { getSpiderRuntime, SpiderError, toSpiderError, type SpiderRuntime } from './runtime';

/** Per-call timeout when the site has none (Site.timeout is normally always set, 15 s by default). */
export const DEFAULT_SPIDER_TIMEOUT = 15_000;

const SPIDER = '__JS_SPIDER__';

const CHECK_SPIDER = `if (typeof globalThis.${SPIDER} !== 'object' || globalThis.${SPIDER} === null) throw new Error('Spider module exported no object (default export or __jsEvalReturn)');`;

function isJsonObject(text: string): boolean {
  try {
    return isObject(JSON.parse(text));
  } catch {
    return false;
  }
}

/**
 * The runtime resolves JSON.stringify(result); spiders return either a JSON
 * string or an object. Anything else becomes an empty Result (Result.fromJson).
 */
export function parseSpiderResult(json: string): Result {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return emptyResult();
  }
  if (typeof value === 'string') return parseJsonResult(value);
  return isObject(value) ? normalizeResult(value) : emptyResult();
}

export class JsSpiderProvider implements SiteProvider {
  private ready?: Promise<number>;
  private destroyed = false;

  constructor(
    readonly site: Site,
    private readonly ctx: ProviderContext = {},
    private readonly runtime: SpiderRuntime = getSpiderRuntime(),
  ) {}

  get timeout(): number {
    return this.site.timeout > 0 ? this.site.timeout : DEFAULT_SPIDER_TIMEOUT;
  }

  /** Spider.getExt: cat spiders get { stype, skey, ext }, others the ext (parsed when it is a JSON object). */
  private ext(cat: boolean): unknown {
    const { ext, key } = this.site;
    const value: unknown = isJsonObject(ext) ? JSON.parse(ext) : ext;
    return cat ? { stype: 3, skey: key, ext: value } : value;
  }

  private async bootstrap(id: number): Promise<void> {
    const { runtime, timeout } = this;
    const { api, header } = this.site;
    await runtime.evaluate(id, PRELUDE, PRELUDE_FILENAME, false, timeout);
    let content: string;
    try {
      content = await getText(api, { headers: header, timeout, fetch: this.ctx.fetch });
    } catch (error) {
      throw new SpiderError('ERR_SPIDER_LOAD', `Failed to load spider ${api}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const cat = content.includes('__jsEvalReturn');
    if (usesCrypto(content)) await runtime.evaluate(id, CRYPTO_MODULE, CRYPTO_FILENAME, true, timeout);
    if (usesParser(content)) await runtime.evaluate(id, PARSER_MODULE, PARSER_FILENAME, true, timeout);
    await runtime.registerModule(id, api, content.split(SPIDER).join(`globalThis.${SPIDER}`));
    await runtime.evaluate(id, spiderEntry(api), ENTRY_FILENAME, true, timeout);
    await runtime.evaluate(id, CHECK_SPIDER, ENTRY_FILENAME, false, timeout);
    await runtime.call(id, SPIDER, 'init', JSON.stringify([this.ext(cat)]), timeout);
  }

  private async start(): Promise<number> {
    const id = await this.runtime.createContext();
    try {
      await this.bootstrap(id);
      return id;
    } catch (error) {
      await this.runtime.destroyContext(id).catch(() => undefined);
      throw error;
    }
  }

  /** Lazy, memoised init; a failed init is dropped so the next call retries. */
  private context(): Promise<number> {
    if (this.destroyed) return Promise.reject(new SpiderError('ERR_SPIDER_DESTROYED', `Spider ${this.site.key} was destroyed`));
    if (!this.ready) {
      const ready = this.start().catch((error: unknown) => {
        if (this.ready === ready) this.ready = undefined;
        throw toSpiderError(error);
      });
      this.ready = ready;
    }
    return this.ready;
  }

  private async call(method: string, ...args: unknown[]): Promise<Result> {
    const id = await this.context();
    try {
      return parseSpiderResult(await this.runtime.call(id, SPIDER, method, JSON.stringify(args), this.timeout));
    } catch (error) {
      throw toSpiderError(error);
    }
  }

  /** Resolves once the spider has loaded and `init` returned. */
  async init(): Promise<void> {
    await this.context();
  }

  async home(filter: boolean): Promise<Result> {
    return applyTypes(this.site, await this.call('home', filter));
  }

  homeVideo(): Promise<Result> {
    return this.call('homeVod');
  }

  category(tid: string, page: string, filter: boolean, extend: Record<string, string>): Promise<Result> {
    return this.call('category', tid, page, filter, extend);
  }

  detail(ids: string[]): Promise<Result> {
    return this.call('detail', ids[0] ?? '');
  }

  /** Like Spider.searchContent: the page argument is only passed when it is not the first page. */
  search(key: string, quick: boolean, page = '1'): Promise<Result> {
    return page === '1' ? this.call('search', key, quick) : this.call('search', key, quick, page);
  }

  /** SiteApi.playerContent: default flag, site header when the spider sets none, site key. */
  async player(flag: string, id: string, vipFlags: string[]): Promise<Result> {
    const result = await this.call('play', flag, id, vipFlags);
    return {
      ...result,
      flag: result.flag === '' ? flag : result.flag,
      header: Object.keys(result.header).length === 0 ? { ...this.site.header } : result.header,
      key: this.site.key,
    };
  }

  /** Best-effort `destroy` on the spider, then the context is released. */
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    this.destroyed = true;
    const ready = this.ready;
    this.ready = undefined;
    if (!ready) return;
    let id: number;
    try {
      id = await ready;
    } catch {
      return;
    }
    await this.runtime.call(id, SPIDER, 'destroy', '[]', this.timeout).catch(() => undefined);
    await this.runtime.destroyContext(id).catch(() => undefined);
  }
}
