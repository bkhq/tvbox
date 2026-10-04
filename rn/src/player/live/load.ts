/**
 * Live loading ported from LiveApi.parse + LiveParser.start: download the
 * channel list, parse it, drop empty groups and prepend the favourites group.
 */

import { decodeConfigText } from '../../core/config/decode';
import { type FetchLike, fetchText } from '../../core/http';
import type { Channel, Group, HeaderMap, Live } from '../../core/types';
import { isKeepGroup, KEEP_GROUP_NAME, sameChannel } from './channel';
import { parseLive } from './parser';

export interface LoadLiveOptions {
  /** Overrides the global fetch (tests). */
  fetch?: FetchLike;
  signal?: AbortSignal;
  /** Names of favourite live channels (Keep.getLive keys). */
  keeps?: Iterable<string>;
}

/** Live.getHeaders: header map plus User-Agent / Origin / Referer. */
export function liveHeaders(live: Live): HeaderMap {
  const headers: HeaderMap = { ...live.header };
  if (live.ua !== '') headers['User-Agent'] = live.ua;
  if (live.origin !== '') headers.Origin = live.origin;
  if (live.referer !== '') headers.Referer = live.referer;
  return headers;
}

/** Group.add: merge the URLs into an equal channel, else append a copy. */
function addToGroup(group: Group, channel: Channel): void {
  const exist = group.channel.find((item) => sameChannel(item, channel));
  if (exist) exist.urls.push(...channel.urls);
  else group.channel.push({ ...channel, urls: [...channel.urls] });
}

/** LiveConfig.applyKeepsToGroups: copy favourite channels into the first (keep) group. */
function applyKeeps(groups: Group[], keeps: Iterable<string>): void {
  const names = new Set(keeps);
  const keep = groups[0]!;
  for (const group of groups) {
    if (isKeepGroup(group)) continue;
    for (const channel of group.channel) if (names.has(channel.name)) addToGroup(keep, channel);
  }
}

async function fetchLive(live: Live, options: LoadLiveOptions): Promise<Live> {
  if (live.api !== '') throw new Error('Live spider sources are not supported');
  const { text, url } = await fetchText(live.url, {
    headers: liveHeaders(live),
    timeout: live.timeout,
    fetch: options.fetch,
    signal: options.signal,
  });
  return parseLive(text.trim() === '' ? '' : decodeConfigText(url, text), live);
}

/**
 * Loads the channel groups of a live source. A live that already has groups
 * (inline JSON config) is used as is, like LiveParser.start. The returned
 * copy has empty groups removed and, when any remain, the "收藏" group first.
 */
export async function loadLive(live: Live, options: LoadLiveOptions = {}): Promise<Live> {
  const loaded = live.groups.length > 0 ? { ...live, groups: [...live.groups] } : await fetchLive(live, options);
  const groups = loaded.groups.filter((group) => group.channel.length > 0);
  if (groups.length > 0 && !isKeepGroup(groups[0]!)) {
    groups.unshift({ name: KEEP_GROUP_NAME, pass: '', channel: [] });
    applyKeeps(groups, options.keeps ?? []);
  }
  return { ...loaded, groups };
}
