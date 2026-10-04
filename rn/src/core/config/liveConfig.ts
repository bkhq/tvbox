/**
 * Live config loader compatible with LiveConfig.java. Parsing M3U/TXT
 * channel lists is not done here: a non-JSON live source becomes a single
 * Live whose `url` the playback layer parses.
 */

import type { RequestOptions } from '../http';
import {
  type HostHeader,
  type JsonObject,
  type Live,
  normalizeHostHeader,
  normalizeLive,
  normalizeProxy,
  normalizeRule,
  type Proxy,
  type Rule,
  strList,
} from '../types';
import { decodeConfigText, isJsonObject } from './decode';
import {
  distinctBy,
  elementList,
  expandRemoteArrays,
  fetchConfigText,
  objectArray,
  parseDepot,
  toConfigObject,
} from './common';

export interface LiveConfig {
  /** URL the config was loaded from (the first depot entry for a depot). */
  url: string;
  lives: Live[];
  /** Selected live source; undefined when there are none. */
  home?: Live;
  rules: Rule[];
  ads: string[];
  hosts: string[];
  headers: HostHeader[];
  proxy: Proxy[];
}

export interface LiveConfigPrefs {
  /** Name of the previously selected live source. */
  home?: string;
}

/** Parses `lives` entries (Live.objectFrom + distinct by name). */
export function parseLives(object: JsonObject): Live[] {
  return distinctBy(elementList(object, 'lives').map(normalizeLive), (live) => live.name);
}

/** LiveConfig.setHome: the saved home name if present, else the first source. */
export function selectLiveHome(lives: Live[], home?: string): Live | undefined {
  return lives.find((live) => live.name === home) ?? lives[0];
}

/** UrlUtil.getName: last path segment, else host, else the URL itself. */
export function nameFromUrl(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/i.exec(url);
  if (!match) return url;
  const segment = (match[2] ?? '').split('/').filter((part) => part !== '').pop() ?? '';
  let name = segment;
  try {
    name = decodeURIComponent(segment);
  } catch {
    // keep the raw segment
  }
  const host = (match[1] ?? '').replace(/^.*@/, '').replace(/:\d+$/, '').toLowerCase();
  return name.trim() || host || url;
}

function buildLiveConfig(object: JsonObject, url: string, prefs: LiveConfigPrefs): LiveConfig {
  const lives = parseLives(object);
  return {
    url,
    lives,
    home: selectLiveHome(lives, prefs.home),
    rules: objectArray(object, 'rules').map(normalizeRule),
    ads: strList(object.ads),
    hosts: strList(object.hosts),
    headers: objectArray(object, 'headers').map(normalizeHostHeader),
    proxy: objectArray(object, 'proxy').map(normalizeProxy),
  };
}

function textLiveConfig(url: string): LiveConfig {
  const live = normalizeLive({ name: nameFromUrl(url), url });
  return { url, lives: [live], home: live, rules: [], ads: [], hosts: [], headers: [], proxy: [] };
}

/** LiveConfig.load: decoded text that is a JSON object is a config, anything else a channel list. */
function readLive(text: string, url: string): JsonObject | undefined {
  const decoded = decodeConfigText(url, text);
  return isJsonObject(decoded) ? toConfigObject(decoded) : undefined;
}

/** Pure parse of live config text. Depot configs are rejected; use loadLiveConfig. */
export function parseLiveConfig(text: string, url: string, prefs: LiveConfigPrefs = {}): LiveConfig {
  const object = readLive(text, url);
  if (!object) return textLiveConfig(url);
  if ('urls' in object) throw new Error('Config is a depot');
  return buildLiveConfig(object, url, prefs);
}

/** Downloads and parses a live config, following a depot to its first entry. */
export async function loadLiveConfig(
  url: string,
  prefs: LiveConfigPrefs = {},
  options?: RequestOptions,
): Promise<LiveConfig> {
  const fetched = await fetchConfigText(url, options);
  const object = readLive(fetched.text, fetched.url);
  if (!object) return textLiveConfig(url);
  if ('urls' in object) {
    const first = parseDepot(object)[0];
    if (!first) throw new Error('Depot urls is empty');
    return loadLiveConfig(first.url, prefs, options);
  }
  return buildLiveConfig(await expandRemoteArrays(object, options), url, prefs);
}
