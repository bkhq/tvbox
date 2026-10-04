/**
 * Pure channel navigation ported from LivePlaybackController (moveChannel,
 * moveGroup, switchLine, fallbackAfterError), LiveActivity (key direction,
 * hidden groups, unlock) and LiveConfig (findByChannelNumber,
 * findKeepPosition). Settings are passed in as flags.
 */

import { type Channel, type Group, javaSplit } from '../../core/types';
import { findLineIndex, formatChannelNumber, isHiddenGroup, isKeepGroup } from './channel';

/** Selected group and channel index within the visible group list. */
export interface LivePosition {
  group: number;
  channel: number;
}

const KEEP_SYMBOL = '@@@';

function wrap(position: number, size: number): number {
  return ((position % size) + size) % size;
}

/** LiveActivity.setGroup: groups with a password stay hidden until unlocked. */
export function splitHiddenGroups(groups: Group[]): { visible: Group[]; hidden: Group[] } {
  const visible: Group[] = [];
  const hidden: Group[] = [];
  for (const group of groups) (isHiddenGroup(group) ? hidden : visible).push(group);
  return { visible, hidden };
}

/**
 * LiveActivity.unlock: appends every hidden group whose password matches
 * (all of them when `pass` is undefined). `selected` is the index of the
 * first unlocked group in the new visible list.
 */
export function unlockGroups(
  visible: Group[],
  hidden: Group[],
  pass: string | undefined,
): { visible: Group[]; hidden: Group[]; selected?: number } {
  const unlocked = hidden.filter((group) => pass === undefined || pass === group.pass);
  return {
    visible: [...visible, ...unlocked],
    hidden: hidden.filter((group) => !unlocked.includes(group)),
    selected: unlocked.length > 0 ? visible.length : undefined,
  };
}

/** LivePlaybackController.moveGroup: next non-empty, non-keep group in `delta` direction. */
function moveGroup(groups: Group[], position: LivePosition, delta: number): LivePosition {
  const count = groups.length;
  if (count <= 1) return position;
  let index = position.group;
  for (let i = 0; i < count; i++) {
    index = wrap(index + delta, count);
    if (index === position.group) return position;
    const target = groups[index]!;
    if (isKeepGroup(target) || target.channel.length === 0) continue;
    return { group: index, channel: delta > 0 ? 0 : target.channel.length - 1 };
  }
  return position;
}

/**
 * LivePlaybackController.moveChannel: step `delta` channels. Past either end
 * of the group it wraps within the group, or moves to the neighbouring group
 * when `across` is on. Returns undefined when the current group is empty.
 */
export function moveChannel(
  groups: Group[],
  position: LivePosition,
  delta: number,
  across: boolean,
): LivePosition | undefined {
  const group = groups[position.group];
  if (!group || group.channel.length === 0) return undefined;
  const size = group.channel.length;
  const next = position.channel + delta;
  const limit = next < 0 || next >= size;
  if (across && limit) return moveGroup(groups, position, delta);
  return { group: position.group, channel: limit ? wrap(next, size) : next };
}

export function nextChannel(groups: Group[], position: LivePosition, across: boolean): LivePosition | undefined {
  return moveChannel(groups, position, 1, across);
}

export function prevChannel(groups: Group[], position: LivePosition, across: boolean): LivePosition | undefined {
  return moveChannel(groups, position, -1, across);
}

/** LiveActivity.onKeyUp / onKeyDown: `invert` swaps the D-pad direction. */
export function channelForKey(
  groups: Group[],
  position: LivePosition,
  key: 'up' | 'down',
  settings: { across: boolean; invert: boolean },
): LivePosition | undefined {
  const forward = (key === 'down') !== settings.invert;
  return moveChannel(groups, position, forward ? 1 : -1, settings.across);
}

/** Channel.switchLine: next / previous source, wrapping; unchanged for a single source. */
export function switchLine(channel: Channel, index: number, next: boolean): number {
  const size = channel.urls.length;
  if (size <= 1) return index;
  return wrap(index + (next ? 1 : -1), size);
}

/**
 * LivePlaybackController.fallbackAfterError: with `change` on, a failed
 * source moves to the next one until the last; undefined means stop.
 */
export function lineAfterError(channel: Channel, index: number, change: boolean): number | undefined {
  if (!change || channel.urls.length === 0 || index >= channel.urls.length - 1) return undefined;
  return switchLine(channel, index, true);
}

/** LiveConfig.findByChannelNumber: last channel with that number in the first group containing it. */
export function findByChannelNumber(groups: Group[], number: string): LivePosition | undefined {
  if (!/^[+-]?\d+$/.test(number)) return undefined;
  const wanted = formatChannelNumber(parseInt(number, 10));
  for (let i = 0; i < groups.length; i++) {
    const channels = groups[i]!.channel;
    for (let j = channels.length - 1; j >= 0; j--) {
      if (channels[j]!.number === wanted) return { group: i, channel: j };
    }
  }
  return undefined;
}

/** Live.keep value: "group@@@channel@@@url". */
export function keepValue(group: Group, channel: Channel, url: string): string {
  return [group.name, channel.name, url].join(KEEP_SYMBOL);
}

/**
 * LiveConfig.findKeepPosition: position (and source line) saved in
 * `Live.keep`, else group 1 channel 0 (the first group after "收藏").
 */
export function findKeepPosition(groups: Group[], keep: string): LivePosition & { line: number } {
  const fallback = { group: 1, channel: 0, line: 0 };
  const parts = javaSplit(keep, KEEP_SYMBOL);
  if (parts.length < 3 || parts[1] === '') return fallback;
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i]!;
    if (group.name !== parts[0]) continue;
    let j = -1;
    for (let k = group.channel.length - 1; k >= 0; k--) {
      if (group.channel[k]!.name === parts[1]) {
        j = k;
        break;
      }
    }
    if (j !== -1) return { group: i, channel: j, line: findLineIndex(group.channel[j]!, parts[2]!) ?? 0 };
  }
  return fallback;
}
