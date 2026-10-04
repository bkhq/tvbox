/**
 * Core data types mirroring the Java beans under
 * app/src/main/java/com/fongmi/android/tv/bean. Field names follow the
 * beans' @SerializedName values so spider / CMS JSON maps onto them directly.
 *
 * The `normalize*` helpers turn loose JSON into typed objects with the same
 * defaults the Java getters apply (empty string / 0 / false / []).
 */

export type Json = unknown;
export type JsonObject = Record<string, unknown>;
export type HeaderMap = Record<string, string>;

/** Default play timeout in milliseconds (Constant.TIMEOUT_PLAY). */
export const TIMEOUT_PLAY = 15_000;

// ---------------------------------------------------------------------------
// Loose JSON readers (Gson-like coercion)

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** String field: Gson coerces primitives to strings; anything else is "". */
export function str(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Numeric field with a default for missing or non-numeric values. */
export function num(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

export function bool(value: unknown): boolean {
  return value === true || value === 'true' || value === 1;
}

/** Number or undefined when absent (Java nullable Integer/Float fields). */
function optNum(value: unknown): number | undefined {
  const parsed = num(value, NaN);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item !== null && item !== undefined).map(str);
}

function list<T>(value: unknown, map: (item: JsonObject) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map(map);
}

/** Json.toMap: object (or JSON string of an object) to a string map. */
export function headerMap(value: unknown): HeaderMap {
  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return {};
    }
  }
  if (!isObject(source)) return {};
  const result: HeaderMap = {};
  for (const [key, item] of Object.entries(source)) {
    result[key] = typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' ? String(item).trim() : '';
  }
  return result;
}

/** ExtAdapter: primitives as string, arrays/objects as their JSON text. */
export function extString(value: unknown): string {
  if (Array.isArray(value) || isObject(value)) return JSON.stringify(value);
  return str(value).trim();
}

/**
 * Java String.split(regex) semantics for a literal separator: trailing empty
 * strings are dropped, but an input without any separator is returned as is.
 */
export function javaSplit(text: string, separator: string): string[] {
  const parts = text.split(separator);
  if (parts.length === 1) return parts;
  while (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// ---------------------------------------------------------------------------
// Config beans

export interface Style {
  type: string;
  ratio: number;
}

export type SiteUnsupportedReason = 'jar' | 'py' | 'type';

export interface Site {
  key: string;
  name: string;
  /** 0 = CMS XML, 1 = CMS JSON, 3 = spider, 4 = CMS JSON with base64 ext. */
  type: number;
  api: string;
  ext: string;
  click: string;
  playUrl: string;
  /** 1 = on, 0 = never, 2 = turned off by the user. */
  searchable: number;
  quickSearch: number;
  changeable: number;
  /** 1 hides the site from the home picker. */
  hide: number;
  indexs: number;
  /** Request timeout in milliseconds. */
  timeout: number;
  categories: string[];
  header: HeaderMap;
  style?: Style;
  /** Computed by the config loader: whether this app can run the site. */
  supported: boolean;
  unsupportedReason?: SiteUnsupportedReason;
}

export interface ParseExt {
  flag: string[];
  header: HeaderMap;
}

export interface Parse {
  name: string;
  /** 0 = sniff (web), 1 = json, 2 = json extended, 3 = json aggregate, 4 = super. */
  type: number;
  url: string;
  ext: ParseExt;
}

export interface Rule {
  name: string;
  hosts: string[];
  regex: string[];
  script: string[];
  exclude: string[];
}

export interface Doh {
  name: string;
  url: string;
  ips: string[];
}

/** `headers` config entry: inject response headers for a host. */
export interface HostHeader {
  host: string;
  header: HeaderMap;
}

export interface Proxy {
  name: string;
  hosts: string[];
  urls: string[];
}

/** A saved config address (VOD, live or wallpaper). */
export interface ConfigEntry {
  url: string;
  name: string;
  /** Last load time in epoch milliseconds; 0 when never loaded. */
  time: number;
}

// ---------------------------------------------------------------------------
// Live beans

export interface Catchup {
  type: string;
  days: string;
  regex: string;
  source: string;
  replace: string;
}

export interface Channel {
  urls: string[];
  number: string;
  logo: string;
  epg: string;
  name: string;
  ua: string;
  click: string;
  format: string;
  origin: string;
  referer: string;
  tvgId: string;
  tvgName: string;
  catchup: Catchup;
  header: HeaderMap;
  parse: number;
}

export interface Group {
  name: string;
  pass: string;
  channel: Channel[];
}

export interface Live {
  name: string;
  url: string;
  api: string;
  ext: string;
  click: string;
  logo: string;
  epg: string;
  ua: string;
  origin: string;
  referer: string;
  timeZone: string;
  keep: string;
  /** Request timeout in milliseconds. */
  timeout: number;
  header: HeaderMap;
  catchup: Catchup;
  groups: Group[];
  boot: boolean;
  pass: boolean;
}

// ---------------------------------------------------------------------------
// Spider / CMS result beans

export interface Vod {
  vod_id: string;
  vod_name: string;
  type_name: string;
  vod_pic: string;
  vod_remarks: string;
  vod_year: string;
  vod_area: string;
  vod_director: string;
  vod_actor: string;
  vod_content: string;
  vod_play_from: string;
  vod_play_url: string;
  vod_tag: string;
  action: string;
  land: number;
  circle: number;
  ratio: number;
  style?: Style;
}

export interface FilterValue {
  n: string;
  v: string;
}

export interface Filter {
  key: string;
  name: string;
  init: string;
  value: FilterValue[];
}

export interface Class {
  type_id: string;
  type_name: string;
  type_flag: string;
  filters: Filter[];
  land: number;
  circle: number;
  ratio: number;
}

export interface Sub {
  url: string;
  name: string;
  lang: string;
  format: string;
  flag: number;
}

/** Result.url: one or more named play URLs. */
export interface PlayUrl {
  values: FilterValue[];
  position: number;
}

export interface Result {
  class: Class[];
  list: Vod[];
  filters: Record<string, Filter[]>;
  page: number;
  pagecount: number;
  limit: number;
  total: number;
  url: PlayUrl;
  header: HeaderMap;
  msg: string;
  playUrl: string;
  artwork: string;
  jxFrom: string;
  flag: string;
  desc: string;
  format: string;
  click: string;
  key: string;
  subs: Sub[];
  position?: number;
  parse: number;
  code: number;
  jx: number;
}

export interface Episode {
  name: string;
  desc: string;
  url: string;
  /** Episode number guessed from the name; -1 when none. */
  number: number;
}

export interface Flag {
  flag: string;
  episodes: Episode[];
}

// ---------------------------------------------------------------------------
// Persisted user data

export interface History {
  /** `${siteKey}@@@${vodId}` */
  key: string;
  vodPic: string;
  vodName: string;
  vodFlag: string;
  vodRemarks: string;
  episodeUrl: string;
  revSort: boolean;
  revPlay: boolean;
  createTime: number;
  opening: number;
  ending: number;
  position: number;
  duration: number;
  speed: number;
  scale: number;
  cid: number;
}

export interface Keep {
  key: string;
  siteName: string;
  vodName: string;
  vodPic: string;
  createTime: number;
  /** 0 = VOD, 1 = live. */
  type: number;
  cid: number;
}

// ---------------------------------------------------------------------------
// Normalisers

function normalizeStyle(value: unknown): Style | undefined {
  if (!isObject(value)) return undefined;
  return { type: str(value.type) || 'rect', ratio: num(value.ratio) };
}

function timeoutMs(value: unknown): number {
  const seconds = optNum(value);
  return seconds === undefined ? TIMEOUT_PLAY : Math.max(Math.trunc(seconds), 1) * 1000;
}

/** Site without the loader-computed support fields. */
export function normalizeSite(json: JsonObject): Omit<Site, 'supported' | 'unsupportedReason'> {
  return {
    key: str(json.key),
    name: str(json.name),
    type: num(json.type),
    api: str(json.api),
    ext: extString(json.ext),
    click: str(json.click),
    playUrl: str(json.playUrl),
    searchable: num(json.searchable, 1),
    quickSearch: num(json.quickSearch, 1),
    changeable: num(json.changeable, 1),
    hide: num(json.hide),
    indexs: num(json.indexs),
    timeout: timeoutMs(json.timeout),
    categories: strList(json.categories),
    header: headerMap(json.header),
    style: normalizeStyle(json.style),
  };
}

export function normalizeParse(json: JsonObject): Parse {
  const ext = isObject(json.ext) ? json.ext : {};
  return {
    name: str(json.name),
    type: num(json.type),
    url: str(json.url),
    ext: { flag: strList(ext.flag), header: headerMap(ext.header) },
  };
}

export function normalizeRule(json: JsonObject): Rule {
  return {
    name: str(json.name),
    hosts: strList(json.hosts),
    regex: strList(json.regex),
    script: strList(json.script),
    exclude: strList(json.exclude),
  };
}

export function normalizeDoh(json: JsonObject): Doh {
  return { name: str(json.name), url: str(json.url), ips: strList(json.ips) };
}

export function normalizeHostHeader(json: JsonObject): HostHeader {
  return { host: str(json.host), header: headerMap(json.header) };
}

export function normalizeProxy(json: JsonObject): Proxy {
  return { name: str(json.name), hosts: strList(json.hosts), urls: strList(json.urls) };
}

export function normalizeCatchup(value: unknown): Catchup {
  const json = isObject(value) ? value : {};
  return {
    type: str(json.type),
    days: str(json.days),
    regex: str(json.regex),
    source: str(json.source),
    replace: str(json.replace),
  };
}

export function normalizeChannel(json: JsonObject): Channel {
  return {
    urls: strList(json.urls),
    number: str(json.number),
    logo: str(json.logo),
    epg: str(json.epg),
    name: str(json.name),
    ua: str(json.ua),
    click: str(json.click),
    format: str(json.format),
    origin: str(json.origin),
    referer: str(json.referer),
    tvgId: str(json.tvgId),
    tvgName: str(json.tvgName),
    catchup: normalizeCatchup(json.catchup),
    header: headerMap(json.header),
    parse: num(json.parse),
  };
}

export function normalizeGroup(json: JsonObject): Group {
  return { name: str(json.name), pass: str(json.pass), channel: list(json.channel, normalizeChannel) };
}

export function normalizeLive(json: JsonObject): Live {
  return {
    name: str(json.name),
    url: str(json.url),
    api: str(json.api),
    ext: extString(json.ext),
    click: str(json.click),
    logo: str(json.logo),
    epg: str(json.epg),
    ua: str(json.ua),
    origin: str(json.origin),
    referer: str(json.referer),
    timeZone: str(json.timeZone),
    keep: str(json.keep),
    timeout: timeoutMs(json.timeout),
    header: headerMap(json.header),
    catchup: normalizeCatchup(json.catchup),
    groups: list(json.groups, normalizeGroup),
    boot: bool(json.boot),
    pass: bool(json.pass),
  };
}

export function normalizeVod(json: JsonObject): Vod {
  return {
    vod_id: str(json.vod_id).trim(),
    vod_name: str(json.vod_name).trim(),
    type_name: str(json.type_name).trim(),
    vod_pic: str(json.vod_pic).trim(),
    vod_remarks: str(json.vod_remarks).trim(),
    vod_year: str(json.vod_year).trim(),
    vod_area: str(json.vod_area).trim(),
    vod_director: str(json.vod_director).trim(),
    vod_actor: str(json.vod_actor).trim(),
    vod_content: str(json.vod_content).trim(),
    vod_play_from: str(json.vod_play_from),
    vod_play_url: str(json.vod_play_url),
    vod_tag: str(json.vod_tag),
    action: str(json.action),
    land: num(json.land),
    circle: num(json.circle),
    ratio: num(json.ratio),
    style: normalizeStyle(json.style),
  };
}

export function normalizeFilterValue(json: JsonObject): FilterValue {
  return { n: str(json.n), v: str(json.v).trim() };
}

export function normalizeFilter(json: JsonObject): Filter {
  return {
    key: str(json.key),
    name: str(json.name),
    init: str(json.init),
    value: list(json.value, normalizeFilterValue),
  };
}

export function normalizeClass(json: JsonObject): Class {
  return {
    type_id: str(json.type_id ?? json.id),
    type_name: str(json.type_name ?? json.name),
    type_flag: str(json.type_flag),
    filters: list(json.filters, normalizeFilter),
    land: num(json.land),
    circle: num(json.circle),
    ratio: num(json.ratio),
  };
}

export function normalizeSub(json: JsonObject): Sub {
  return {
    url: str(json.url),
    name: str(json.name),
    lang: str(json.lang),
    format: str(json.format),
    flag: num(json.flag),
  };
}

/** FilterAdapter: each key maps to one filter object or an array of them. */
function normalizeFilters(value: unknown): Record<string, Filter[]> {
  const result: Record<string, Filter[]> = {};
  if (!isObject(value)) return result;
  for (const [key, item] of Object.entries(value)) {
    result[key] = isObject(item) ? [normalizeFilter(item)] : list(item, normalizeFilter);
  }
  return result;
}

/** UrlAdapter: string, flat [name, url, name, url, ...] array, or {values, position}. */
function normalizePlayUrl(value: unknown): PlayUrl {
  if (Array.isArray(value)) {
    const values: FilterValue[] = [];
    for (let i = 0; i + 1 < value.length; i += 2) values.push({ n: str(value[i]), v: str(value[i + 1]).trim() });
    return { values, position: 0 };
  }
  if (isObject(value)) return { values: list(value.values, normalizeFilterValue), position: num(value.position) };
  if (value === undefined || value === null) return { values: [], position: 0 };
  return { values: [{ n: '', v: str(value).trim() }], position: 0 };
}

export function normalizeResult(json: JsonObject): Result {
  const code = num(json.code);
  return {
    class: list(json.class, normalizeClass),
    list: list(json.list, normalizeVod),
    filters: normalizeFilters(json.filters),
    page: num(json.page),
    pagecount: num(json.pagecount),
    limit: num(json.limit),
    total: num(json.total),
    url: normalizePlayUrl(json.url),
    header: headerMap(json.header),
    msg: code !== 0 ? '' : str(json.msg),
    playUrl: str(json.playUrl),
    artwork: str(json.artwork),
    jxFrom: str(json.jxFrom),
    flag: str(json.flag),
    desc: str(json.desc),
    format: str(json.format),
    click: str(json.click),
    key: str(json.key),
    subs: list(json.subs, normalizeSub),
    position: optNum(json.position),
    parse: num(json.parse),
    code,
    jx: num(json.jx),
  };
}

export function normalizeHistory(json: JsonObject): History {
  return {
    key: str(json.key),
    vodPic: str(json.vodPic),
    vodName: str(json.vodName),
    vodFlag: str(json.vodFlag),
    vodRemarks: str(json.vodRemarks),
    episodeUrl: str(json.episodeUrl),
    revSort: bool(json.revSort),
    revPlay: bool(json.revPlay),
    createTime: num(json.createTime),
    opening: num(json.opening),
    ending: num(json.ending),
    position: num(json.position),
    duration: num(json.duration),
    speed: num(json.speed),
    scale: num(json.scale),
    cid: num(json.cid),
  };
}

export function normalizeKeep(json: JsonObject): Keep {
  return {
    key: str(json.key),
    siteName: str(json.siteName),
    vodName: str(json.vodName),
    vodPic: str(json.vodPic),
    createTime: num(json.createTime),
    type: num(json.type),
    cid: num(json.cid),
  };
}

// ---------------------------------------------------------------------------
// Flag / Episode parsing (Vod.setFlags, Flag.setEpisodes, Util.getNumber)

const EPISODE_NUMBER = /(?:ep|第|e|[-.\s])\s?(\d{1,4})/i;

/** Util.getNumber: best-effort episode number from a name, -1 when none. */
export function episodeNumber(name: string): number {
  let text = name.replace(/\[.*?\]|\(.*?\)/g, '');
  text = text.replace(/\b(19|20)\d{2}\b/g, '');
  text = text.toLowerCase().replace(/2160p|1080p|720p|480p|4k|h26[45]|x26[45]|mp4/g, '');
  const match = EPISODE_NUMBER.exec(text);
  if (match?.[1]) return parseInt(match[1], 10);
  const digits = text.replace(/\D+/g, '');
  if (digits === '') return -1;
  const parsed = parseInt(digits, 10);
  return parsed > 2147483647 ? -1 : parsed;
}

export function createEpisode(name: string, url: string, desc = ''): Episode {
  return { name, desc, url, number: episodeNumber(name) };
}

/** Flag.setEpisodes: "name$url#name$url"; unnamed entries are numbered 01, 02, ... */
export function parseEpisodes(playUrl: string): Episode[] {
  const items = playUrl.includes('#') ? javaSplit(playUrl, '#') : [playUrl];
  const episodes: Episode[] = [];
  items.forEach((item, i) => {
    const index = item.indexOf('$');
    const number = String(i + 1).padStart(2, '0');
    const episode =
      index >= 0
        ? createEpisode(index === 0 ? number : item.slice(0, index).trim(), item.slice(index + 1))
        : createEpisode(number, item);
    if (!episodes.some((e) => e.name === episode.name && e.url === episode.url)) episodes.push(episode);
  });
  return episodes;
}

/** Vod.setFlags: split vod_play_from / vod_play_url on "$$$" into play sources. */
export function parseFlags(vod: Pick<Vod, 'vod_play_from' | 'vod_play_url'>): Flag[] {
  const playUrls = javaSplit(vod.vod_play_url, '$$$');
  const playFlags = javaSplit(vod.vod_play_from, '$$$');
  const flags: Flag[] = [];
  playFlags.forEach((from, i) => {
    const flag = from.trim();
    const url = playUrls[i];
    if (flag === '' || !url) return;
    flags.push({ flag, episodes: parseEpisodes(url) });
  });
  return flags;
}
