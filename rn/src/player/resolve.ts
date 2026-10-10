/**
 * VOD resolve flow: SiteApi.playerContent through the site provider, then
 * PlaybackActivity.startPlayer / ParseJob.java. JSON parsers (type 1) and the
 * extended / aggregate / super parsers (2, 3, 4) reduce to JSON parse calls;
 * web sniffing (type 0) runs through the injected `sniff` (see sniff.ts).
 */

import type { VodConfig } from '../core/config';
import { type FetchLike, getText, mergeHeaders } from '../core/http';
import { getProvider as defaultGetProvider, type SiteProvider } from '../core/provider';
import { type Flag, isObject, type Parse, parseFlags, type Result, type Site, str, type Vod } from '../core/types';
import type { EngineSource, ExternalSubtitle } from './engine/types';
import type { SniffRequest } from './sniff';

/** Constant.TIMEOUT_PARSE_DEF. */
export const TIMEOUT_PARSE = 15_000;

export const MSG_PARSE_FAILED = '播放地址解析失败';
export const MSG_WEB_PARSE = '暂不支持网页解析';
export const MSG_PLAY_URL = '播放地址加载失败';
export const MSG_NO_DETAIL = '暂无播放数据';

export class PlaybackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlaybackError';
  }
}

export interface ResolveDeps {
  config: Pick<VodConfig, 'parses' | 'parse' | 'flags'>;
  /** The `ua` setting; added as User-Agent when the media has none. */
  ua: string;
  fetch?: FetchLike;
  getProvider?: (site: Site) => SiteProvider;
  /** Web sniffer for type 0 parsers; without it they fail with MSG_WEB_PARSE. */
  sniff?: (request: SniffRequest) => Promise<ResolvedMedia>;
}

/** What the engine needs, minus the per-play title and start position. */
export type ResolvedMedia = Omit<EngineSource, 'title' | 'startPosition'> & {
  /** Result.position: start position the site asks for (ms). */
  position?: number;
  /** Name of the parser that produced the URL. */
  from?: string;
};

/** A parse to run: the parser and the page URL handed to it. */
export interface ParseJobSpec {
  parse: Parse;
  webUrl: string;
  flag: string;
  /** Headers of the player result; used when the parser declares none. */
  headers: Record<string, string>;
  format?: string;
  subtitles: ExternalSubtitle[];
  position?: number;
  /** ParseJob.getClick: Site.click, else Result.click; run by the web sniffer. */
  click?: string;
}

export type PlayerDecision = { type: 'direct'; media: ResolvedMedia } | { type: 'parse'; job: ParseJobSpec };

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/** PlaySpec.checkUa: the `ua` setting when no User-Agent is given. */
export function withUserAgent(headers: Record<string, string>, ua: string): Record<string, string> {
  if (ua === '' || hasHeader(headers, 'User-Agent')) return headers;
  return { ...headers, 'User-Agent': ua };
}

/** Result.getUrl().v(): the value at the selected position of a multi-value url. */
export function playValue(result: Pick<Result, 'url'>): string {
  const { values, position } = result.url;
  if (values.length === 0) return '';
  return values[Math.min(Math.max(position, 0), values.length - 1)]!.v;
}

function subtitles(result: Result): ExternalSubtitle[] {
  return result.subs
    .filter((sub) => sub.url !== '')
    .map((sub) => ({ url: sub.url, name: sub.name, lang: sub.lang || undefined, format: sub.format || undefined }));
}

/** Result.isUseParse: the flag is a VIP flag of the config (or jx = 1) and parsers exist. */
function isVipParse(result: Result, config: ResolveDeps['config']): boolean {
  if (config.parses.length === 0) return false;
  return (result.playUrl === '' && config.flags.includes(result.flag)) || result.jx === 1;
}

function needParse(result: Result): boolean {
  return result.parse === 1 || result.jx === 1;
}

/** ParseJob.setParse: which parser handles this result. */
export function selectParse(result: Result, config: ResolveDeps['config'], vip: boolean): Parse {
  let parse: Parse | undefined;
  if (vip) parse = config.parse;
  if (result.playUrl.startsWith('json:')) parse = createParse(1, result.playUrl.slice(5));
  if (result.playUrl.startsWith('parse:')) {
    const name = result.playUrl.slice(6);
    parse = config.parses.find((item) => item.name === name);
  }
  if (!parse || (parse.type === 0 && parse.url === '')) parse = createParse(0, result.playUrl);
  return parse;
}

function createParse(type: number, url: string): Parse {
  return { name: '', type, url, ext: { flag: [], header: {} } };
}

/** detailContent: the vod and its play sources; throws when there is nothing to play. */
export async function loadVod(
  site: Site,
  vodId: string,
  deps: Pick<ResolveDeps, 'getProvider'> = {},
): Promise<{ vod: Vod; flags: Flag[] }> {
  const provider = (deps.getProvider ?? defaultGetProvider)(site);
  const result = await provider.detail([vodId]);
  const vod = result.list[0];
  if (!vod) throw new PlaybackError(result.msg || MSG_NO_DETAIL);
  const flags = parseFlags(vod).filter((flag) => flag.episodes.length > 0);
  if (flags.length === 0) throw new PlaybackError(MSG_NO_DETAIL);
  return { vod, flags };
}

/** Calls provider.player and decides between direct playback and a parse job. */
export async function resolvePlayer(site: Site, flag: string, episodeUrl: string, deps: ResolveDeps): Promise<PlayerDecision> {
  const provider = (deps.getProvider ?? defaultGetProvider)(site);
  const result = await provider.player(flag, episodeUrl, deps.config.flags);
  if (result.msg !== '') throw new PlaybackError(result.msg);
  const headers = mergeHeaders(site.header, result.header);
  const flagName = result.flag || flag;
  const vip = isVipParse({ ...result, flag: flagName }, deps.config);
  const value = playValue(result);
  const position = result.position;
  if (needParse(result) || vip) {
    const parse = selectParse(result, deps.config, vip);
    const click = site.click || result.click;
    return {
      type: 'parse',
      job: {
        parse,
        webUrl: value,
        flag: flagName,
        headers,
        format: result.format || undefined,
        subtitles: subtitles(result),
        position,
        ...(click ? { click } : {}),
      },
    };
  }
  const url = result.playUrl + value;
  if (url === '') throw new PlaybackError(MSG_PLAY_URL);
  return {
    type: 'direct',
    media: { url, headers: withUserAgent(headers, deps.ua), format: result.format || undefined, subtitles: subtitles(result), position },
  };
}

/** ParseJob.getHeader: User-Agent / Referer / Cookie (and "ua") from the parse response. */
function responseHeaders(object: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(object)) {
    if (value === null || value === undefined) continue;
    const lower = key.toLowerCase();
    if (lower === 'user-agent' || lower === 'ua') headers['User-Agent'] = str(value);
    else if (lower === 'referer') headers.Referer = str(value);
    else if (lower === 'cookie') headers.Cookie = str(value);
  }
  return headers;
}

/** ParseJob.startWeb: sniff parser url + page url in a hidden WebView. */
async function webParse(parse: Parse, job: ParseJobSpec, deps: ResolveDeps): Promise<ResolvedMedia> {
  if (!deps.sniff) throw new PlaybackError(MSG_WEB_PARSE);
  const headers = Object.keys(parse.ext.header).length > 0 ? parse.ext.header : job.headers;
  const media = await deps.sniff({ url: parse.url + job.webUrl, headers: withUserAgent(headers, deps.ua), click: job.click });
  return { ...media, format: job.format, subtitles: job.subtitles, position: job.position, from: parse.name || undefined };
}

/** ParseJob.jsonParse: GET parser url + page url; a url longer than 40 chars is a hit. */
async function jsonParse(parse: Parse, job: ParseJobSpec, deps: ResolveDeps): Promise<ResolvedMedia> {
  const parseHeaders = Object.keys(parse.ext.header).length > 0 ? parse.ext.header : job.headers;
  const text = await getText(parse.url + job.webUrl, { headers: parseHeaders, fetch: deps.fetch, timeout: TIMEOUT_PARSE });
  const object: unknown = JSON.parse(text);
  if (!isObject(object)) throw new PlaybackError(MSG_PARSE_FAILED);
  const url = str(object.url) || (isObject(object.data) ? str(object.data.url) : '');
  if (url.length <= 40) throw new PlaybackError(MSG_PARSE_FAILED);
  const found = responseHeaders(object);
  const headers = Object.keys(found).length > 0 ? found : parseHeaders;
  const withoutRange = Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'range'));
  return {
    url,
    headers: withUserAgent(withoutRange, deps.ua),
    format: job.format,
    subtitles: job.subtitles,
    position: job.position,
    from: parse.name || undefined,
  };
}

/** VodConfig.getParses(type, flag): parsers of a type, narrowed to those declaring `flag` when any do. */
export function parsesFor(parses: Parse[], type: number, flag?: string): Parse[] {
  const items = parses.filter((item) => item.type === type);
  if (flag === undefined) return items;
  const filtered = items.filter((item) => item.ext.flag.includes(flag));
  return filtered.length > 0 ? filtered : items;
}

async function firstSequential(parses: Parse[], job: ParseJobSpec, deps: ResolveDeps): Promise<ResolvedMedia> {
  for (const parse of parses) {
    try {
      return await jsonParse(parse, job, deps);
    } catch {
      // Try the next parser.
    }
  }
  throw new PlaybackError(MSG_PARSE_FAILED);
}

/** Runs a parse job; rejects with a PlaybackError carrying a Chinese message. */
export async function runParse(job: ParseJobSpec, deps: ResolveDeps): Promise<ResolvedMedia> {
  const { parse } = job;
  switch (parse.type) {
    case 1:
      try {
        return await jsonParse(parse, job, deps);
      } catch {
        throw new PlaybackError(MSG_PARSE_FAILED);
      }
    case 2:
    case 3:
      // jsonExt / jsonExtMix run in the JAR loader; without it, try the JSON parsers in order.
      return firstSequential(parsesFor(deps.config.parses, 1), job, deps);
    case 4: {
      // superParse: every JSON parser for the flag at once, first hit wins.
      const parses = parsesFor(deps.config.parses, 1, job.flag);
      if (parses.length === 0) throw new PlaybackError(MSG_PARSE_FAILED);
      try {
        return await Promise.any(parses.map((item) => jsonParse(item, job, deps)));
      } catch {
        throw new PlaybackError(MSG_PARSE_FAILED);
      }
    }
    case 0:
      return webParse(parse, job, deps);
    default:
      throw new PlaybackError(MSG_WEB_PARSE);
  }
}

/** Message for any resolve / parse failure. */
export function errorMessage(error: unknown): string {
  if (error instanceof PlaybackError) return error.message;
  return MSG_PLAY_URL;
}
