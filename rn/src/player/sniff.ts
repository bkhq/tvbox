/**
 * Web page sniffing (parse type 0): Sniffer.java + CustomWebView.java. A hidden
 * native WebView loads the page and reports every request; the first request
 * URL that looks like media (config rules first, then the SNIFFER pattern) wins.
 */

import type { SnifferModule } from '../../modules/sniffer';
import type { Rule } from '../core/types';
import { MSG_PARSE_FAILED, MSG_WEB_PARSE, PlaybackError, type ResolvedMedia } from './resolve';

/** Constant.TIMEOUT_PARSE_WEB. */
export const TIMEOUT_PARSE_WEB = 15_000;

/** Sniffer.SNIFFER. */
export const SNIFFER =
  /https?:\/\/[^\s]{12,}\.(?:m3u8|mp4|mkv|flv|mp3|m4a|aac|mpd)(?:\?.*)?|https?:\/\/.*?video\/tos[^\s]*|rtmp:[^\s]+/;

export interface SniffRequest {
  /** Page to load. */
  url: string;
  /** Headers for the page load; also the fallback headers of the hit. */
  headers: Record<string, string>;
  /** Site.click / Result.click script. */
  click?: string;
}

export interface SniffDeps {
  /** The native `sniffer` module; injectable for tests. */
  native: SnifferModule | null | undefined;
  rules?: Rule[];
  timeout?: number;
  signal?: AbortSignal;
}

function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(url);
  return match?.[1]?.toLowerCase().trim() ?? '';
}

/** Uri.getQueryParameter(name), decoded; "" when absent. */
function queryParam(url: string, name: string): string {
  const query = url.split('#')[0]!.split('?').slice(1).join('?');
  for (const pair of query.split('&')) {
    const [key, ...rest] = pair.split('=');
    if (key !== name) continue;
    const value = rest.join('=').replace(/\+/g, ' ');
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return '';
}

/** Util.containOrMatch: substring, or a full match of the (Java) regex. */
function containOrMatch(text: string, regex: string): boolean {
  if (text.includes(regex)) return true;
  try {
    return new RegExp(`^(?:${regex})$`).test(text);
  } catch {
    return false;
  }
}

function find(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return false;
  }
}

/** Sniffer.getRule: the rule whose hosts match the url's host or that of its `url` parameter. */
function getRule(url: string, rules: Rule[]): Rule | undefined {
  const host = hostOf(url);
  if (host === '') return undefined;
  const hosts = [host, hostOf(queryParam(url, 'url'))].join(',');
  return rules.find((rule) => rule.hosts.some((item) => containOrMatch(hosts, item)));
}

/** Sniffer.isVideoFormat. */
export function isVideoFormat(url: string, rules: Rule[] = []): boolean {
  const rule = getRule(url, rules);
  if (rule) {
    if (rule.exclude.some((exclude) => url.includes(exclude))) return false;
    if (rule.exclude.some((exclude) => find(exclude, url))) return false;
    if (rule.regex.some((regex) => url.includes(regex))) return true;
    if (rule.regex.some((regex) => find(regex, url))) return true;
  }
  if (url.includes('url=http') || url.includes('v=http') || url.includes('.html')) return false;
  return SNIFFER.test(url);
}

/** CustomWebView.getScript: the rule scripts with the click script first, deduplicated. */
export function sniffScripts(url: string, rules: Rule[] = [], click = ''): string[] {
  const scripts = [...(getRule(url, rules)?.script ?? [])];
  if (click === '' || scripts.includes(click)) return scripts;
  return [click, ...scripts];
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === lower);
}

/** Headers to play the hit with: the intercepted ones, else the page headers plus Referer. */
function hitHeaders(hit: Record<string, string>, request: SniffRequest): Record<string, string> {
  const base = Object.keys(hit).length > 0 ? hit : { ...request.headers, Referer: request.url };
  const headers = Object.fromEntries(Object.entries(base).filter(([key]) => key.toLowerCase() !== 'range'));
  if (!hasHeader(headers, 'User-Agent')) {
    const ua = Object.entries(request.headers).find(([key]) => key.toLowerCase() === 'user-agent');
    if (ua) headers['User-Agent'] = ua[1];
  }
  return headers;
}

let sessions = 0;

/** Loads the page in a hidden WebView and resolves with the first media request. */
export function sniffMedia(request: SniffRequest, deps: SniffDeps): Promise<ResolvedMedia> {
  const { native, rules = [], timeout = TIMEOUT_PARSE_WEB, signal } = deps;
  if (!native || !native.isSupported()) return Promise.reject(new PlaybackError(MSG_WEB_PARSE));
  const id = `sniff-${++sessions}`;
  return new Promise<ResolvedMedia>((resolve, reject) => {
    let done = false;
    const finish = (error: Error | undefined, media?: ResolvedMedia) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      subscription.remove();
      signal?.removeEventListener('abort', onAbort);
      native.stop(id).catch(() => undefined);
      if (error) reject(error);
      else resolve(media!);
    };
    const onAbort = () => finish(new PlaybackError(MSG_PARSE_FAILED));
    const subscription = native.addRequestListener((event) => {
      if (event.id !== id || !isVideoFormat(event.url, rules)) return;
      finish(undefined, { url: event.url, headers: hitHeaders(event.headers ?? {}, request), subtitles: [] });
    });
    const timer = setTimeout(() => finish(new PlaybackError(MSG_PARSE_FAILED)), timeout);
    if (signal?.aborted) return onAbort();
    signal?.addEventListener('abort', onAbort);
    const scripts = sniffScripts(request.url, rules, request.click);
    native.start(id, request.url, request.headers, scripts, timeout).catch((error: unknown) => {
      console.warn('Sniffer start failed', error);
      finish(new PlaybackError(MSG_WEB_PARSE));
    });
  });
}
