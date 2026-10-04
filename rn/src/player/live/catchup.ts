/**
 * Catchup (time-shift) URL building ported from bean/Catchup.java and the
 * catchup parts of bean/Channel.java / bean/EpgData.java.
 */

import { type Catchup, type Channel, normalizeCatchup } from '../../core/types';
import { channelUrl } from './channel';
import { formatInZone } from './zone';

/** Programme interval a catchup URL is built for (EpgData start/end times). */
export interface CatchupRange {
  startTime: number;
  endTime: number;
}

const TOKEN = /(\$?\{[^}]*\})/g;
const TAG = /\{([^}]+)\}/;

/** Catchup.PLTV: default for Huawei "/PLTV/" URLs without an explicit catchup. */
export function pltvCatchup(): Catchup {
  return normalizeCatchup({
    type: 'append',
    days: '7',
    regex: '/PLTV/',
    replace: '/PLTV/,/TVOD/',
    source: '?playseek=${(b)yyyyMMddHHmmss}-${(e)yyyyMMddHHmmss}',
  });
}

/** Catchup.isEmpty: a catchup without a source template is none. */
export function isCatchupEmpty(catchup: Catchup): boolean {
  return catchup.source === '';
}

/** The channel's catchup, or the PLTV default when the current line is a "/PLTV/" URL. */
export function channelCatchup(channel: Channel, line: number): Catchup {
  if (isCatchupEmpty(channel.catchup) && channelUrl(channel, line).includes('/PLTV/')) return pltvCatchup();
  return channel.catchup;
}

function matches(catchup: Catchup, url: string): boolean {
  if (url.includes(catchup.regex)) return true;
  try {
    return new RegExp(catchup.regex).test(url);
  } catch {
    return false;
  }
}

/** Channel.hasCatchup for source line `line`. */
export function hasCatchup(channel: Channel, line: number): boolean {
  const catchup = channelCatchup(channel, line);
  if (catchup.regex !== '') return matches(catchup, channelUrl(channel, line));
  return !isCatchupEmpty(catchup);
}

function formatTime(millis: number, pattern: string, zone: string): string {
  if (pattern === 'timestamp') return String(Math.trunc(millis / 1000));
  return formatInZone(millis, pattern, zone);
}

function formatToken(token: string, range: CatchupRange, zone: string): string {
  const tag = TAG.exec(token)?.[1];
  if (tag === undefined) return '';
  const paren = tag.indexOf(')');
  if (tag.startsWith('(b') && paren >= 0) return formatTime(range.startTime, tag.slice(paren + 1), zone);
  if (tag.startsWith('(e') && paren >= 0) return formatTime(range.endTime, tag.slice(paren + 1), zone);
  if (tag.startsWith('utcend:')) return String(Math.trunc(range.endTime / 1000));
  if (tag.startsWith('utc:')) return String(Math.trunc(range.startTime / 1000));
  return '';
}

function hasQuery(url: string): boolean {
  const index = url.indexOf('?');
  if (index < 0) return false;
  return url.slice(index + 1).replace(/#.*$/, '') !== '';
}

/**
 * Catchup.format: expands the source template for `range` and, unless the
 * type is "default", appends it to `url` after applying `replace`
 * ("from,to", a regex replacement). Times are formatted in `zone` (empty =
 * device zone, as Java uses ZoneId.systemDefault()).
 */
export function buildCatchupUrl(catchup: Catchup, url: string, range: CatchupRange, zone = ''): string {
  let result = catchup.source;
  for (const token of catchup.source.match(TOKEN) ?? []) {
    result = result.replaceAll(token, formatToken(token, range, zone));
  }
  if (catchup.type === 'default') return result;
  const index = catchup.replace.indexOf(',');
  if (index >= 0) {
    try {
      url = url.replace(new RegExp(catchup.replace.slice(0, index), 'g'), catchup.replace.slice(index + 1));
    } catch {
      // invalid pattern: keep the URL
    }
  }
  if (hasQuery(url)) result = result.replaceAll('?', '&');
  return url + result;
}

/** EpgData.getRange: RTSP "clock=" range header value in UTC. */
export function rtspRange(range: CatchupRange): string {
  const pattern = "yyyyMMdd'T'HHmmss'Z'";
  return `clock=${formatInZone(range.startTime, pattern, 'UTC')}-${formatInZone(range.endTime, pattern, 'UTC')}`;
}
