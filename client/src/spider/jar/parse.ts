/**
 * JSON extended / aggregate parsers (types 2 and 3) run by the JAR loader:
 * ParseJob.jsonExtend / jsonMix and checkResult(Result). Android only.
 */

import { isObject, normalizeResult, type Parse } from '../../core/types';
import { type ParseJobSpec, playValue, type ResolvedMedia, TIMEOUT_PARSE, withUserAgent } from '../../player/resolve';
import { getInstalledJarSpider } from './install';

const BASE64_URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Util.base64(s, URL_SAFE): UTF-8, url-safe alphabet, padded, no wrap. */
export function base64UrlSafe(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += BASE64_URL[(n >> 18) & 63]! + BASE64_URL[(n >> 12) & 63]!;
    out += b === undefined ? '=' : BASE64_URL[(n >> 6) & 63]!;
    out += c === undefined ? '=' : BASE64_URL[n & 63]!;
  }
  return out;
}

/** Parse.Ext.toString (Gson): empty fields are left out like Gson's null fields. */
function extJson(parse: Parse): string {
  const { flag, header } = parse.ext;
  return JSON.stringify({ ...(flag.length > 0 ? { flag } : {}), ...(Object.keys(header).length > 0 ? { header } : {}) });
}

/** Parse.extUrl: the ext goes into the query as base64 `cat_ext`. */
export function extUrl(parse: Parse): string {
  const index = parse.url.indexOf('?');
  const { flag, header } = parse.ext;
  if ((flag.length === 0 && Object.keys(header).length === 0) || index === -1) return parse.url;
  return `${parse.url.slice(0, index + 1)}cat_ext=${base64UrlSafe(extJson(parse))}&${parse.url.slice(index + 1)}`;
}

/** Parse.mixMap. */
export function mixMap(parse: Parse): Record<string, string> {
  return { type: String(parse.type), ext: extJson(parse), url: parse.url };
}

function parseObject(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text);
  return isObject(value) ? value : {};
}

export const jarParse = {
  available(): boolean {
    return getInstalledJarSpider() !== undefined;
  },

  /** ParseJob.jsonExtend: jxs = every type 1 parser, name -> extUrl. */
  async jsonExt(parse: Parse, parses: Parse[], url: string): Promise<Record<string, unknown>> {
    const native = getInstalledJarSpider();
    if (!native) throw new Error('JarSpider is not available');
    const jxs = Object.fromEntries(parses.filter((item) => item.type === 1).map((item) => [item.name, extUrl(item)]));
    return parseObject(await native.jsonExt(parse.url, JSON.stringify(jxs), url));
  },

  /** ParseJob.jsonMix: jxs = every parser, name -> mixMap. */
  async jsonExtMix(parse: Parse, parses: Parse[], url: string, flag: string): Promise<Record<string, unknown>> {
    const native = getInstalledJarSpider();
    if (!native) throw new Error('JarSpider is not available');
    const jxs = Object.fromEntries(parses.map((item) => [item.name, mixMap(item)]));
    return parseObject(await native.jsonExtMix(flag, parse.url, parse.name, JSON.stringify(jxs), url));
  },
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('JAR parse timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Runs a type 2 / 3 job in the JAR loader and converts the result like
 * ParseJob.checkResult(Result). Undefined when the loader is unavailable, the
 * call fails, there is no url, or the result needs web sniffing.
 */
export async function tryJarParse(job: ParseJobSpec, parses: Parse[], ua = ''): Promise<ResolvedMedia | undefined> {
  const { parse } = job;
  if (!jarParse.available() || (parse.type !== 2 && parse.type !== 3)) return undefined;
  let object: Record<string, unknown>;
  try {
    const call = parse.type === 2 ? jarParse.jsonExt(parse, parses, job.webUrl) : jarParse.jsonExtMix(parse, parses, job.webUrl, job.flag);
    object = await withTimeout(call, TIMEOUT_PARSE);
  } catch {
    return undefined;
  }
  const result = normalizeResult(object);
  const url = playValue(result);
  if (url === '' || result.parse === 1 || result.jx === 1) return undefined;
  // result.setHeader(parse.getHeader()): the parser's header, else the player's (ParseJob.setParse).
  const parseHeaders = Object.keys(parse.ext.header).length > 0 ? parse.ext.header : job.headers;
  const headers = Object.keys(result.header).length > 0 ? result.header : parseHeaders;
  return {
    url,
    headers: withUserAgent(headers, ua),
    format: job.format,
    subtitles: job.subtitles,
    position: job.position,
    from: result.jxFrom || undefined,
  };
}
