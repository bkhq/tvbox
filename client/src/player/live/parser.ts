/**
 * Channel list parsing ported from api/parser/LiveParser.java: a JSON group
 * array, an M3U playlist or a TXT ("group,#genre#" / "name,url") list.
 *
 * Not ported: DRM (#KODIPROP license lines are recognised but ignored; the
 * core Channel has no drm field) and Trans s2t conversion.
 */

import {
  type Catchup,
  type Channel,
  type Group,
  headerMap,
  type HeaderMap,
  isObject,
  type Live,
  normalizeCatchup,
  normalizeChannel,
  normalizeGroup,
} from '../../core/types';
import { channelTvgId, channelTvgName, DEFAULT_GROUP_NAME, formatChannelNumber, sameChannel } from './channel';

const MIME_DASH = 'application/dash+xml';
const MIME_HLS = 'application/x-mpegURL';

const M3U = /^(?!.*#genre#).*#EXTM3U.*/m;
const attribute = (name: string) => new RegExp(`^.*${name}="(.?|.+?)".*$`);
const HTTP_USER_AGENT = attribute('http-user-agent');
const CATCHUP_REPLACE = attribute('catchup-replace');
const CATCHUP_SOURCE = attribute('catchup-source');
const CATCHUP = attribute('catchup');
const TVG_CHNO = attribute('tvg-chno');
const TVG_LOGO = attribute('tvg-logo');
const TVG_NAME = attribute('tvg-name');
const TVG_URL = attribute('tvg-url');
const TVG_ID = attribute('tvg-id');
const URL_TVG = attribute('url-tvg');
const GROUP = attribute('group-title');
const NAME = /^.*,(.+?)$/;

// ---------------------------------------------------------------------------
// Java string helpers

/** String.split(regex) with limit 0: trailing empty strings are dropped. */
function javaSplit(text: string, separator: string | RegExp): string[] {
  if (text === '') return [''];
  const parts = text.split(separator);
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** String.split(regex, 2). */
function splitOnce(text: string, separator: string): string[] {
  const index = text.indexOf(separator);
  return index < 0 ? [text] : [text.slice(0, index), text.slice(index + separator.length)];
}

/** `line.split(regex)[1]`; undefined where Java would throw. */
function after(line: string, separator: string | RegExp): string | undefined {
  return javaSplit(line, separator)[1];
}

function extract(line: string, pattern: RegExp): string {
  const match = pattern.exec(line.trim());
  return match ? (match[1] ?? '').trim() : '';
}

function extractKeyword(line: string, ...keywords: string[]): string {
  for (const split of javaSplit(line, ' ')) {
    for (const keyword of keywords) {
      if (split.includes(keyword)) return (javaSplit(split, '=')[1] ?? '').replaceAll('"', '');
    }
  }
  return '';
}

// ---------------------------------------------------------------------------
// Bean helpers (Group / Channel / Catchup semantics)

/** Group(name, pass): "name_pass" carries a password unless the live source is unlocked. */
export function createGroup(name: string, pass: boolean): Group {
  const group: Group = { name, pass: '', channel: [] };
  if (name.includes('_')) {
    const [head = '', tail] = splitOnce(name, '_');
    group.name = head;
    if (!pass && tail !== undefined) group.pass = tail;
  }
  if (name === '') group.name = DEFAULT_GROUP_NAME;
  return group;
}

function isCatchupEmpty(catchup: Catchup): boolean {
  return catchup.source === '';
}

function findGroup(groups: Group[], item: Group): Group {
  const found = groups.find((group) => group.name === item.name);
  if (found) return found;
  groups.push(item);
  return item;
}

function findChannel(group: Group, item: Channel): Channel {
  const found = group.channel.find((channel) => sameChannel(channel, item));
  if (found) return found;
  group.channel.push(item);
  return item;
}

const newChannel = (name: string): Channel => normalizeChannel({ name });

/** Live.getEpgApi: the first comma-separated epg entry holding a template. */
export function epgApiOf(live: Pick<Live, 'epg'>): string {
  return live.epg.split(',').find((url) => url.includes('{')) ?? live.epg;
}

/** Channel.live: inherit source-level defaults and expand epg / logo templates. */
function inherit(channel: Channel, live: Live): void {
  if (live.ua && !channel.ua) channel.ua = live.ua;
  if (live.click && !channel.click) channel.click = live.click;
  if (Object.keys(live.header).length > 0 && Object.keys(channel.header).length === 0) channel.header = { ...live.header };
  if (live.origin && !channel.origin) channel.origin = live.origin;
  if (!isCatchupEmpty(live.catchup) && isCatchupEmpty(channel.catchup)) channel.catchup = { ...live.catchup };
  if (live.referer && !channel.referer) channel.referer = live.referer;
  if (live.epg.includes('{') && !channel.epg.startsWith('http')) {
    channel.epg = epgApiOf(live)
      .replaceAll('{id}', channelTvgId(channel))
      .replaceAll('{name}', channelTvgName(channel))
      .replaceAll('{epg}', channel.epg);
  }
  if (live.logo.includes('{') && !channel.logo.startsWith('http')) {
    channel.logo = live.logo
      .replaceAll('{id}', channelTvgId(channel))
      .replaceAll('{name}', channelTvgName(channel))
      .replaceAll('{logo}', channel.logo);
  }
}

// ---------------------------------------------------------------------------
// Per-line playback options (LiveParser.Setting)

class Setting {
  ua?: string;
  click?: string;
  format?: string;
  origin?: string;
  referer?: string;
  parse?: number;
  header: HeaderMap = {};

  static find(line: string): boolean {
    return ['ua', 'parse', 'click', 'header', 'format', 'origin', 'referer', 'forceKey', '#EXTHTTP:', '#EXTVLCOPT:', '#KODIPROP:'].some(
      (prefix) => line.startsWith(prefix),
    );
  }

  check(line: string): void {
    if (line.startsWith('ua')) this.setUa(line);
    else if (line.startsWith('parse')) this.setParse(line);
    else if (line.startsWith('click')) this.click = after(line, 'click=')?.trim();
    else if (line.startsWith('header')) this.setHeader(line);
    else if (line.startsWith('format')) this.setFormat(line);
    else if (line.startsWith('origin')) this.setOrigin(line);
    else if (line.startsWith('referer')) this.referer = after(line, /referer=/i)?.trim().replaceAll('"', '');
    else if (line.startsWith('#EXTHTTP:')) this.setHeader(line);
    else if (line.startsWith('forceKey')) return;
    else if (line.startsWith('#EXTVLCOPT:http-cookie')) this.setCookie(line);
    else if (line.startsWith('#EXTVLCOPT:http-origin')) this.setOrigin(line);
    else if (line.startsWith('#EXTVLCOPT:http-user-agent')) this.setUa(line);
    else if (line.startsWith('#EXTVLCOPT:http-referrer')) this.referer = after(line, /referrer=/i)?.trim().replaceAll('"', '');
    else if (line.startsWith('#KODIPROP:inputstream.adaptive.manifest_type')) this.setFormat(line);
    else if (line.startsWith('#KODIPROP:inputstream.adaptive.stream_headers')) this.headers(line);
    else if (line.startsWith('#KODIPROP:inputstream.adaptive.common_headers')) this.headers(line);
  }

  copy(channel: Channel): this {
    if (this.ua !== undefined) channel.ua = this.ua;
    if (this.parse !== undefined) channel.parse = this.parse;
    if (this.click !== undefined) channel.click = this.click;
    if (this.format !== undefined) channel.format = this.format;
    if (this.origin !== undefined) channel.origin = this.origin;
    if (this.referer !== undefined) channel.referer = this.referer;
    if (Object.keys(this.header).length > 0) channel.header = { ...this.header };
    return this;
  }

  clear(): void {
    this.ua = undefined;
    this.click = undefined;
    this.format = undefined;
    this.origin = undefined;
    this.referer = undefined;
    this.parse = undefined;
    this.header = {};
  }

  private setUa(line: string): void {
    if (line.includes('user-agent=')) this.ua = after(line, /user-agent=/i)?.trim().replaceAll('"', '');
    if (line.includes('ua=')) this.ua = after(line, 'ua=')?.trim().replaceAll('"', '');
  }

  private setParse(line: string): void {
    const value = after(line, 'parse=')?.trim() ?? '';
    this.parse = /^[+-]?\d+$/.test(value) ? Number(value) : undefined;
  }

  private setFormat(line: string): void {
    let format = this.format;
    if (line.startsWith('format=')) format = after(line, 'format=')?.trim();
    if (line.includes('manifest_type=')) format = after(line, 'manifest_type=')?.trim();
    if (format === 'mpd' || format === 'dash') format = MIME_DASH;
    if (format === 'hls') format = MIME_HLS;
    this.format = format;
  }

  private setOrigin(line: string): void {
    this.origin = after(line, /origin=/i)?.trim();
  }

  private setCookie(line: string): void {
    const cookie = after(line, /cookie=/i);
    if (cookie !== undefined) this.header.Cookie = cookie.trim().replaceAll('"', '');
  }

  private setHeader(line: string): void {
    const read = (text: string | undefined) => {
      const value = text === undefined ? undefined : (JSON.parse(text.trim()) as unknown);
      if (isObject(value)) Object.assign(this.header, headerMap(value));
    };
    try {
      if (line.includes('#EXTHTTP:')) read(after(line, '#EXTHTTP:'));
      if (line.includes('header=')) read(after(line, 'header='));
    } catch {
      // invalid JSON header line is ignored
    }
  }

  /** Setting.headers: "k=v&k=v", optionally after "headers=" or joined by "|". */
  headers(line: string): void {
    if (line.includes('headers=')) this.putParams((after(line, 'headers=') ?? '').trim().split('&'));
    else if (line.includes('|')) for (const text of javaSplit(line, '|')) this.headers(text);
    else this.putParams(line.trim().split('&'));
  }

  private putParams(params: string[]): void {
    for (const param of params) {
      if (!param.includes('=')) continue;
      const [rawKey = '', rawValue = ''] = splitOnce(param, '=');
      const key = rawKey.trim().replaceAll('"', '');
      if (key === 'drmScheme' || key === 'drmLicense') continue;
      this.header[key] = rawValue.trim().replaceAll('"', '');
    }
  }
}

// ---------------------------------------------------------------------------
// Formats

function parseM3u(live: Live, text: string, groups: Group[]): string {
  const setting = new Setting();
  const catchup = normalizeCatchup({});
  let epg = live.epg;
  let channel = newChannel('');
  for (const line of javaSplit(text, '\n')) {
    if (Setting.find(line)) {
      setting.check(line);
    } else if (line.startsWith('#EXTM3U')) {
      catchup.type = extract(line, CATCHUP);
      catchup.source = extract(line, CATCHUP_SOURCE);
      catchup.replace = extract(line, CATCHUP_REPLACE);
      if (epg === '') epg = extract(line, TVG_URL).replaceAll('"', '');
      if (epg === '') epg = extract(line, URL_TVG).replaceAll('"', '');
      if (epg === '') epg = extractKeyword(line, 'tvg-url=', 'url-tvg=');
    } else if (line.startsWith('#EXTINF:')) {
      const group = findGroup(groups, createGroup(extract(line, GROUP), live.pass));
      channel = findChannel(group, newChannel(extract(line, NAME)));
      channel.ua = extract(line, HTTP_USER_AGENT);
      channel.tvgName = extract(line, TVG_NAME);
      channel.number = extract(line, TVG_CHNO);
      channel.logo = extract(line, TVG_LOGO);
      channel.tvgId = extract(line, TVG_ID);
      const own = normalizeCatchup({
        type: extract(line, CATCHUP),
        source: extract(line, CATCHUP_SOURCE),
        replace: extract(line, CATCHUP_REPLACE),
      });
      // Catchup.decide: the channel's own catchup, else the playlist's, else none.
      channel.catchup = !isCatchupEmpty(own) ? own : !isCatchupEmpty(catchup) ? { ...catchup } : normalizeCatchup({});
    } else if (!line.startsWith('#') && line.includes('://')) {
      const [url = '', options] = splitOnce(line, '|');
      if (options !== undefined) setting.headers(options);
      channel.urls.push(url);
      setting.copy(channel).clear();
    }
  }
  return epg;
}

function parseTxt(live: Live, text: string, groups: Group[]): void {
  const setting = new Setting();
  for (const line of javaSplit(text, '\n')) {
    const split = splitOnce(line, ',');
    if (Setting.find(line)) setting.check(line);
    if (line.includes('#genre#')) {
      setting.clear();
      groups.push(createGroup(split[0] ?? '', live.pass));
    }
    if (split.length > 1 && groups.length === 0) groups.push(createGroup(DEFAULT_GROUP_NAME, false));
    const urls = split[1];
    if (urls === undefined || !urls.includes('://')) continue;
    const group = groups[groups.length - 1]!;
    const channel = findChannel(group, newChannel(split[0] ?? ''));
    for (const url of javaSplit(urls, '#')) {
      const [address = '', options] = splitOnce(url, '|');
      if (options !== undefined) setting.headers(options);
      channel.urls.push(address);
      setting.copy(channel);
    }
  }
}

function jsonGroups(text: string): Group[] | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value.filter(isObject).map(normalizeGroup) : undefined;
  } catch {
    return undefined;
  }
}

/** LiveParser.apply: number unnumbered channels and inherit source defaults. */
function apply(live: Live, groups: Group[]): void {
  let number = 0;
  for (const group of groups) {
    for (const channel of group.channel) {
      if (channel.number === '') channel.number = formatChannelNumber(++number);
      inherit(channel, live);
    }
  }
}

/**
 * Parses channel list text for `live` (LiveParser.start minus the download).
 * Returns a copy of `live` with `groups` filled and `epg` taken from the M3U
 * header when the source had none. A live that already has groups is
 * returned unchanged, as in Java.
 */
export function parseLive(text: string, live: Live): Live {
  if (live.groups.length > 0) return live;
  const json = jsonGroups(text);
  const groups: Group[] = json ?? [];
  let epg = live.epg;
  if (!json) {
    const normalized = text.replaceAll('\r\n', '\n').replaceAll('\r', '');
    if (M3U.test(normalized)) epg = parseM3u(live, normalized, groups);
    else parseTxt(live, normalized, groups);
  }
  const result: Live = { ...live, epg, groups };
  apply(result, groups);
  return result;
}

/** Parses channel list text (JSON / M3U / TXT) into groups. */
export function parseLiveText(text: string, live: Live): Group[] {
  return parseLive(text, live).groups;
}
