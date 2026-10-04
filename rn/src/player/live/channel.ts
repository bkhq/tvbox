/**
 * Channel / Group helpers mirroring the getters of bean/Channel.java and
 * bean/Group.java that the core types leave to callers.
 */

import type { Channel, Group, HeaderMap } from '../../core/types';
import { normalizeCatchup } from '../../core/types';

/** R.string.setting_live: name of a group without a name. */
export const DEFAULT_GROUP_NAME = '直播';
/** R.string.keep: name of the favourites group LiveApi.parse prepends. */
export const KEEP_GROUP_NAME = '收藏';

/** Channel.getTvgName: falls back to the channel name. */
export function channelTvgName(channel: Channel): string {
  return channel.tvgName || channel.name;
}

/** Channel.getTvgId: falls back to tvg-name, then the channel name. */
export function channelTvgId(channel: Channel): string {
  return channel.tvgId || channelTvgName(channel);
}

/** Channel.equals: by name when both have one, else by number. */
export function sameChannel(a: Channel, b: Channel): boolean {
  if (a === b) return true;
  if (a.name !== '' && b.name !== '') return a.name === b.name;
  if (a.number !== '' && b.number !== '') return a.number === b.number;
  return false;
}

export function emptyChannel(name = ''): Channel {
  return {
    urls: [],
    number: '',
    logo: '',
    epg: '',
    name,
    ua: '',
    click: '',
    format: '',
    origin: '',
    referer: '',
    tvgId: '',
    tvgName: '',
    catchup: normalizeCatchup(undefined),
    header: {},
    parse: 0,
  };
}

/** Channel.setNumber(int): zero padded to three digits. */
export function formatChannelNumber(number: number): string {
  return String(number).padStart(3, '0');
}

/** Group.isHidden: a group with a password is hidden until unlocked. */
export function isHiddenGroup(group: Group): boolean {
  return group.pass !== '';
}

/** Group.isKeep / Group.skip. */
export function isKeepGroup(group: Group): boolean {
  return group.name === KEEP_GROUP_NAME;
}

/** Channel.getCurrent: the URL of line `index` without its "$name" suffix. */
export function channelUrl(channel: Channel, index: number): string {
  const url = channel.urls[index];
  if (url === undefined) return '';
  return url.split('$')[0] ?? '';
}

/** Channel.getLine: line label, empty when the channel has one line. */
export function lineName(channel: Channel, index: number): string {
  if (channel.urls.length <= 1) return '';
  const parts = (channel.urls[index] ?? '').split('$');
  if (parts.length > 1 && parts[1] !== '') return parts[1]!;
  return `线路 ${index + 1}`;
}

/** Channel.setIndex(String): line index of a saved URL, or undefined. */
export function findLineIndex(channel: Channel, line: string): number | undefined {
  const index = channel.urls.findIndex((url) => url === line || (url.includes('$') && line === url.split('$')[0]));
  return index >= 0 ? index : undefined;
}

/** Channel.getHeaders: header map plus User-Agent / Origin / Referer. */
export function channelHeaders(channel: Channel): HeaderMap {
  const headers: HeaderMap = { ...channel.header };
  if (channel.ua !== '') headers['User-Agent'] = channel.ua;
  if (channel.origin !== '') headers.Origin = channel.origin;
  if (channel.referer !== '') headers.Referer = channel.referer;
  return headers;
}
