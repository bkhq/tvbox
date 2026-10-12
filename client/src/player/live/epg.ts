/**
 * Programme guide data ported from api/parser/EpgParser.java,
 * bean/Epg.java and LiveApi.getEpg: XMLTV files (optionally gzip) matched to
 * channels by tvg-id / tvg-name / name, and per-channel JSON (or XMLTV) EPG
 * responses from a `{date}` URL template.
 *
 * Not ported: the on-disk XMLTV cache (Java re-downloads after 6 hours or a
 * day change; callers decide when to reload) and Trans s2t conversion.
 */

import { XMLParser } from 'fast-xml-parser';
import { ungzip } from 'pako';

import { type FetchLike, getText, request } from '../../core/http';
import { type Channel, type Group, isObject, type Live, str } from '../../core/types';
import { channelTvgId, channelTvgName } from './channel';
import { dateInZone, formatInZone, wallToEpoch, zoneOffsetMs } from './zone';

/** One programme (EpgData). Times are epoch milliseconds; start/end are "HH:mm" labels. */
export interface EpgItem {
  title: string;
  start: string;
  end: string;
  startTime: number;
  endTime: number;
}

/** Programmes of one channel (`key` = effective tvg-id) on one date (yyyy-MM-dd). */
export interface Epg {
  key: string;
  date: string;
  list: EpgItem[];
}

/** Result of matching an XMLTV file to channels, keyed by Channel.getTvgId. */
export interface XmltvData {
  /** Programmes per channel key, one Epg per date in ascending date order. */
  epg: Record<string, Epg[]>;
  /** XMLTV channel icons per channel key, used for channels without a logo. */
  logos: Record<string, string>;
}

export interface EpgFetchOptions {
  fetch?: FetchLike;
  signal?: AbortSignal;
  timeout?: number;
  /** Current time in epoch milliseconds (tests). */
  now?: number;
}

export function emptyEpg(): Epg {
  return { key: '', date: '', list: [] };
}

// ---------------------------------------------------------------------------
// Time parsing

const FULL_TIME = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/;
const OFFSET = /^(?:([+-])(\d{2}):?(\d{2})|Z)$/;

function validWall(y: number, mo: number, d: number, h: number, mi: number, s: number): boolean {
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d && h < 24 && mi < 60 && s < 60;
}

/**
 * EpgParser.parseFull: "yyyyMMddHHmmss" optionally followed by an offset
 * ("+0800", "+08:00" or "Z"); without one the time is local to `zone`.
 * Unparseable values become the epoch, as in Java.
 */
export function parseXmltvTime(source: string, zone: string): number {
  const text = source.trim();
  const time = text.length > 14 ? text.slice(0, 14) : text;
  const offset = text.length > 14 ? text.slice(14).trim() : '';
  const match = FULL_TIME.exec(time);
  if (!match) return 0;
  const [y, mo, d, h, mi, s] = match.slice(1).map(Number) as [number, number, number, number, number, number];
  if (!validWall(y, mo, d, h, mi, s)) return 0;
  if (offset === '') return wallToEpoch(zone, y, mo, d, h, mi, s);
  const parsed = OFFSET.exec(offset);
  if (!parsed) return 0;
  const minutes = parsed[1] ? (Number(parsed[2]) * 60 + Number(parsed[3])) * (parsed[1] === '-' ? -1 : 1) : 0;
  return Date.UTC(y, mo - 1, d, h, mi, s) - minutes * 60_000;
}

const EPG_DT = /^(\d{4})-(\d{2})-(\d{2})(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** Epg.parseEpgTime: "yyyy-MM-dd" + "HH:mm" (or "HH:mm:ss") local to `zone`; 0 when invalid. */
function parseEpgTime(source: string, zone: string): number {
  const match = EPG_DT.exec(source);
  if (!match || (source.length > 16) !== (match[6] !== undefined)) return 0;
  const [y, mo, d, h, mi, s] = match.slice(1).map((value) => Number(value ?? 0)) as [number, number, number, number, number, number];
  if (!validWall(y, mo, d, h, mi, s)) return 0;
  return wallToEpoch(zone, y, mo, d, h, mi, s);
}

/** ZonedDateTime.plusDays(1): same wall-clock time on the next day in `zone`. */
function plusDay(epochMs: number, zone: string): number {
  const wall = new Date(epochMs + zoneOffsetMs(zone, epochMs));
  return wallToEpoch(
    zone,
    wall.getUTCFullYear(),
    wall.getUTCMonth() + 1,
    wall.getUTCDate() + 1,
    wall.getUTCHours(),
    wall.getUTCMinutes(),
    wall.getUTCSeconds(),
  );
}

function epgItem(title: string, startTime: number, endTime: number, zone: string): EpgItem {
  return {
    title,
    start: formatInZone(startTime, 'HH:mm', zone),
    end: formatInZone(endTime, 'HH:mm', zone),
    startTime,
    endTime,
  };
}

// ---------------------------------------------------------------------------
// XMLTV reading (bean/Tv.java)

interface TvChannel {
  id: string;
  icon: string;
  displayNames: string[];
}

interface TvProgramme {
  start: string;
  stop: string;
  channel: string;
  title: string;
}

interface Tv {
  date: string;
  channels: TvChannel[];
  programmes: TvProgramme[];
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false,
  parseAttributeValue: false,
});

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined || value === null ? [] : [value];
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  return isObject(value) ? str(value['#text']) : '';
}

function attr(node: unknown, name: string): string {
  return isObject(node) ? str(node[`@_${name}`]) : '';
}

function readTv(xml: string): Tv {
  const root = xmlParser.parse(xml) as unknown;
  const tv = isObject(root) && isObject(root.tv) ? root.tv : {};
  return {
    date: attr(tv, 'date'),
    channels: toArray(tv.channel).map((node) => ({
      id: attr(node, 'id'),
      icon: isObject(node) ? attr(toArray(node.icon)[0], 'src') : '',
      displayNames: isObject(node) ? toArray(node['display-name']).map(textOf) : [],
    })),
    programmes: toArray(tv.programme).map((node) => ({
      start: attr(node, 'start'),
      stop: attr(node, 'stop'),
      channel: attr(node, 'channel'),
      title: isObject(node) ? (toArray(node.title).map(textOf).find((text) => text !== '') ?? '') : '',
    })),
  };
}

function allChannels(groups: Group[]): Channel[] {
  return groups.flatMap((group) => group.channel);
}

/** EpgParser.prepareLiveChannels: lookup by tvg-id, tvg-name and name; the first channel wins. */
function channelIndex(groups: Group[]): Map<string, Channel> {
  const map = new Map<string, Channel>();
  const put = (key: string, channel: Channel) => {
    if (key !== '' && !map.has(key)) map.set(key, channel);
  };
  for (const channel of allChannels(groups)) {
    put(channelTvgId(channel), channel);
    put(channelTvgName(channel), channel);
    put(channel.name, channel);
  }
  return map;
}

/**
 * EpgParser.readXml without the download: matches every programme of an
 * XMLTV document to a channel (by the programme's channel id, else by the
 * XMLTV channel's display names) and buckets it by date in `zone`.
 */
export function parseXmltv(xml: string, groups: Group[], zone: string): XmltvData {
  const tv = readTv(xml);
  const lookup = channelIndex(groups);
  const xmlChannels = new Map<string, TvChannel[]>();
  for (const channel of tv.channels) xmlChannels.set(channel.id, [...(xmlChannels.get(channel.id) ?? []), channel]);

  const cache = new Map<string, Channel | undefined>();
  const find = (id: string): Channel | undefined => {
    if (cache.has(id)) return cache.get(id);
    let target = lookup.get(id);
    if (!target) {
      const name = (xmlChannels.get(id) ?? []).flatMap((channel) => channel.displayNames).find((text) => text !== '' && lookup.has(text));
      target = name === undefined ? undefined : lookup.get(name);
    }
    cache.set(id, target);
    return target;
  };

  const byKey = new Map<string, Map<string, Epg>>();
  const logos: Record<string, string> = {};
  for (const programme of tv.programmes) {
    const target = find(programme.channel);
    if (!target) continue;
    const start = parseXmltvTime(programme.start, zone);
    const end = parseXmltvTime(programme.stop, zone);
    const key = channelTvgId(target);
    const date = dateInZone(start, zone);
    const dates = byKey.get(key) ?? new Map<string, Epg>();
    byKey.set(key, dates);
    const epg = dates.get(date) ?? { key, date, list: [] };
    dates.set(date, epg);
    epg.list.push(epgItem(programme.title, start, end, zone));
    if (!(key in logos)) {
      const icon = (xmlChannels.get(programme.channel) ?? []).find((channel) => channel.icon !== '')?.icon;
      if (icon !== undefined) logos[key] = icon;
    }
  }

  const epg: Record<string, Epg[]> = {};
  for (const [key, dates] of byKey) epg[key] = [...dates.values()].sort((a, b) => a.date.localeCompare(b.date));
  return { epg, logos };
}

/** EpgParser.bindResultsToLive (logo part): fills empty channel logos from XMLTV icons. */
export function applyXmltvLogos(groups: Group[], data: XmltvData): Group[] {
  return groups.map((group) => ({
    ...group,
    channel: group.channel.map((channel) => {
      const logo = data.logos[channelTvgId(channel)];
      return channel.logo === '' && logo !== undefined ? { ...channel, logo } : channel;
    }),
  }));
}

/** Programme guide of `channel` from XMLTV data (Channel.getDataList after binding). */
export function xmltvEpgs(data: XmltvData, channel: Channel): Epg[] {
  return data.epg[channelTvgId(channel)] ?? [];
}

/** Later files replace a channel's programmes; the first icon found is kept. */
function mergeXmltv(into: XmltvData, from: XmltvData): void {
  Object.assign(into.epg, from.epg);
  for (const [key, logo] of Object.entries(from.logos)) if (!(key in into.logos)) into.logos[key] = logo;
}

// ---------------------------------------------------------------------------
// Bytes

function utf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
  let out = '';
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i++]!;
    const extra = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : 0;
    let code = extra === 0 ? b : b & (0x3f >> extra);
    for (let j = 0; j < extra; j++) code = (code << 6) | ((bytes[i++] ?? 0) & 0x3f);
    out += String.fromCodePoint(code <= 0x10ffff ? code : 0xfffd);
  }
  return out;
}

/** EpgParser.isGzip + gzipDecompress: gzip payloads (1f 8b) are inflated, anything else read as UTF-8. */
export function decodeEpgBytes(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) return ungzip(bytes, { to: 'string' });
  return utf8(bytes);
}

// ---------------------------------------------------------------------------
// Loading

/** Live.getEpgXml: comma-separated epg entries without a template that look like XMLTV ("xml" / "gz"). */
export function epgXmlUrls(live: Pick<Live, 'epg'>): string[] {
  return live.epg.split(',').filter((url) => !url.includes('{') && (url.includes('xml') || url.includes('gz')));
}

/**
 * LiveApi.parseXml: downloads every XMLTV url of the live source and matches
 * it to `groups`. `ok` is true when at least one file loaded; failed files
 * are skipped like in Java.
 */
export async function loadXmltv(
  live: Pick<Live, 'epg' | 'timeZone'>,
  groups: Group[],
  options: EpgFetchOptions = {},
): Promise<{ ok: boolean; data: XmltvData }> {
  const data: XmltvData = { epg: {}, logos: {} };
  let ok = false;
  for (const url of epgXmlUrls(live)) {
    try {
      const response = await request(url, { fetch: options.fetch, signal: options.signal, timeout: options.timeout });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      mergeXmltv(data, parseXmltv(decodeEpgBytes(bytes), groups, live.timeZone));
      ok = true;
    } catch {
      // EpgParser failures are logged and skipped
    }
  }
  return { ok, data };
}

/** EpgParser.getEpg: a whole XMLTV document as one Epg (dated by `<tv date>` or today). */
export function parseEpgXml(xml: string, key: string, zone: string, now = Date.now()): Epg {
  try {
    const tv = readTv(xml);
    const date = tv.date === '' ? dateInZone(now, zone) : dateInZone(parseXmltvTime(tv.date, zone), zone);
    const list = tv.programmes.map((programme) =>
      epgItem(programme.title, parseXmltvTime(programme.start, zone), parseXmltvTime(programme.stop, zone), zone),
    );
    return { key, date, list };
  } catch {
    return emptyEpg();
  }
}

/** Epg.objectFrom: a JSON EPG response ({date, epg_data: [{title, start, end}]}) or an XMLTV document. */
export function parseEpgResponse(text: string, key: string, zone: string, now = Date.now()): Epg {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  if (!isObject(json)) return parseEpgXml(text, key, zone, now);
  const date = str(json.date);
  const seen = new Set<string>();
  const list: EpgItem[] = [];
  for (const raw of Array.isArray(json.epg_data) ? json.epg_data : []) {
    if (!isObject(raw)) continue;
    const title = str(raw.title);
    const start = str(raw.start);
    const end = str(raw.end);
    const id = JSON.stringify([title, start, end]);
    if (seen.has(id)) continue;
    seen.add(id);
    const startTime = parseEpgTime(date + start, zone);
    let endTime = parseEpgTime(date + end, zone);
    if (endTime < startTime) endTime = plusDay(endTime, zone);
    list.push({ title, start, end, startTime, endTime });
  }
  return { key, date, list };
}

/**
 * LiveApi.getEpg: fetches yesterday, today and tomorrow from the channel's
 * `{date}` EPG URL (dates in yyyy-MM-dd, `zone`), skipping dates already in
 * `existing`. Returns the merged list and today's Epg (empty when missing).
 */
export async function fetchChannelEpg(
  channel: Channel,
  zone: string,
  existing: Epg[] = [],
  options: EpgFetchOptions = {},
): Promise<{ list: Epg[]; today: Epg }> {
  const now = options.now ?? Date.now();
  const list = [...existing];
  for (const offset of [-1, 0, 1]) {
    const date = dateInZone(now, zone, offset);
    const url = channel.epg.replaceAll('{date}', date);
    if (!url.startsWith('http') || list.some((epg) => epg.date === date)) continue;
    const text = await getText(url, { fetch: options.fetch, signal: options.signal, timeout: options.timeout });
    const epg = parseEpgResponse(text, channelTvgId(channel), zone, now);
    const index = list.findIndex((item) => item.date === epg.date);
    if (index >= 0) list.splice(index, 1);
    list.push(epg);
  }
  const today = dateInZone(now, zone);
  return { list, today: list.find((epg) => epg.date === today) ?? emptyEpg() };
}

// ---------------------------------------------------------------------------
// Queries

/** Epg.getInRange: index of the programme airing at `now`, or -1. */
export function currentProgrammeIndex(epg: Epg, now = Date.now()): number {
  return epg.list.findIndex((item) => item.startTime <= now && now <= item.endTime);
}

/** The programme airing at `now`, if any. */
export function currentProgramme(epg: Epg, now = Date.now()): EpgItem | undefined {
  return epg.list[currentProgrammeIndex(epg, now)];
}

/** Programmes listed for `date` (yyyy-MM-dd), as Channel.getData picks a day. */
export function programmesForDate(epgs: Epg[], date: string): EpgItem[] {
  return epgs.find((epg) => epg.date === date)?.list ?? [];
}

/** EpgData.format: "HH:mm ~ HH:mm  title". */
export function formatEpgItem(item: EpgItem): string {
  if (item.title === '') return '';
  if (item.start === '' && item.end === '') return item.title;
  return `${item.start} ~ ${item.end}  ${item.title}`;
}
