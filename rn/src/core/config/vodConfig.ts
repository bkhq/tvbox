/**
 * VOD config loader compatible with VodConfig.java + BaseConfig.java.
 * `spider` / `jar` fields are ignored: JAR spiders are not supported, and
 * sites that need one stay in the list flagged `supported: false`.
 */

import type { RequestOptions } from '../http';
import {
  type ConfigEntry,
  type Doh,
  type HostHeader,
  type JsonObject,
  type Live,
  normalizeDoh,
  normalizeHostHeader,
  normalizeParse,
  normalizeProxy,
  normalizeRule,
  normalizeSite,
  type Parse,
  type Proxy,
  type Rule,
  type Site,
  type SiteUnsupportedReason,
  str,
  strList,
} from '../types';
import {
  distinctBy,
  elementList,
  expandRemoteArrays,
  fetchConfigText,
  objectArray,
  parseDepot,
  readConfigObject,
} from './common';
import { parseLives } from './liveConfig';

export interface VodConfig {
  /** URL the config was loaded from (the first depot entry for a depot). */
  url: string;
  /** Other configs listed by a depot ("urls"); [] for a regular config. */
  depot: ConfigEntry[];
  /** Every site in the config, including unsupported ones. */
  sites: Site[];
  /** Selected home site; undefined when no site is supported. */
  home?: Site;
  /** Parsers; the built-in "super" parser is prepended when any exist. */
  parses: Parse[];
  /** Selected parser; undefined when there are none. */
  parse?: Parse;
  lives: Live[];
  flags: string[];
  rules: Rule[];
  doh: Doh[];
  ads: string[];
  hosts: string[];
  headers: HostHeader[];
  proxy: Proxy[];
  wallpaper: string;
  logo: string;
  notice: string;
  danmaku: string;
  assrt: string;
}

export interface VodConfigPrefs {
  /** Key of the previously selected home site. */
  home?: string;
  /** Name of the previously selected parser. */
  parse?: string;
}

/** Display name of Parse.god(), the built-in aggregate parser. */
export const SUPER_PARSE_NAME = '超级解析';

/**
 * Which sites this app can run: CMS (type 0/1) and JS spiders (type 3 with
 * a ".js" api). Type 3 JAR classes and Python spiders, type 4 and unknown
 * types are unsupported.
 */
export function classifySite(type: number, api: string): { supported: boolean; unsupportedReason?: SiteUnsupportedReason } {
  if (type === 0 || type === 1) return { supported: true };
  if (type !== 3) return { supported: false, unsupportedReason: 'type' };
  const path = api.replace(/[?#].*$/, '').trim().toLowerCase();
  if (path.endsWith('.js')) return { supported: true };
  return { supported: false, unsupportedReason: path.endsWith('.py') ? 'py' : 'jar' };
}

export function parseSite(json: JsonObject): Site {
  const site = normalizeSite(json);
  return { ...site, ...classifySite(site.type, site.api) };
}

export function supportedSites(config: Pick<VodConfig, 'sites'>): Site[] {
  return config.sites.filter((site) => site.supported);
}

/** VodConfig.initSite home selection, restricted to supported sites. */
export function selectHome(sites: Site[], home?: string): Site | undefined {
  const supported = sites.filter((site) => site.supported);
  return supported.find((site) => site.key === home) ?? supported[0];
}

function superParse(): Parse {
  return { name: SUPER_PARSE_NAME, type: 4, url: '', ext: { flag: [], header: {} } };
}

function buildVodConfig(object: JsonObject, url: string, depot: ConfigEntry[], prefs: VodConfigPrefs): VodConfig {
  const sites = distinctBy(elementList(object, 'sites').map(parseSite), (site) => site.key);
  const parses = distinctBy(elementList(object, 'parses').map(normalizeParse), (parse) => parse.name);
  if (parses.length > 0) parses.unshift(superParse());
  return {
    url,
    depot,
    sites,
    home: selectHome(sites, prefs.home),
    parses,
    parse: parses.find((parse) => parse.name === prefs.parse) ?? parses[0],
    lives: parseLives(object),
    flags: strList(object.flags),
    rules: objectArray(object, 'rules').map(normalizeRule),
    doh: objectArray(object, 'doh').map(normalizeDoh),
    ads: strList(object.ads),
    hosts: strList(object.hosts),
    headers: objectArray(object, 'headers').map(normalizeHostHeader),
    proxy: objectArray(object, 'proxy').map(normalizeProxy),
    wallpaper: str(object.wallpaper).trim(),
    logo: str(object.logo).trim(),
    notice: str(object.notice).trim(),
    danmaku: str(object.danmaku).trim(),
    assrt: str(object.assrt).trim(),
  };
}

/**
 * Pure parse of downloaded config text: decoding, relative URL resolution
 * against `url`, and bean normalisation. Remote array references (string
 * entries in headers/proxy/rules/doh) are skipped; loadVodConfig expands
 * them. Depot configs are rejected; use loadVodConfig.
 */
export function parseVodConfig(text: string, url: string, prefs: VodConfigPrefs = {}): VodConfig {
  const object = readConfigObject(text, url);
  if ('urls' in object) throw new Error('Config is a depot');
  return buildVodConfig(object, url, [], prefs);
}

/** Downloads and parses a VOD config, following a depot to its first entry. */
export async function loadVodConfig(url: string, prefs: VodConfigPrefs = {}, options?: RequestOptions): Promise<VodConfig> {
  const fetched = await fetchConfigText(url, options);
  const object = readConfigObject(fetched.text, fetched.url);
  if ('urls' in object) {
    const depot = parseDepot(object);
    const first = depot[0];
    if (!first) throw new Error('Depot urls is empty');
    const config = await loadVodConfig(first.url, prefs, options);
    return { ...config, depot };
  }
  return buildVodConfig(await expandRemoteArrays(object, options), url, [], prefs);
}
