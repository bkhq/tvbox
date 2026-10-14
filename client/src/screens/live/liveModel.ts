import type { Channel, Group } from '../../core/types';
import {
  currentProgrammeIndex,
  type Epg,
  type EpgItem,
  findKeepPosition,
  isKeepGroup,
  type LivePosition,
} from '../../player/live';
import { sameChannel } from '../../player/live/channel';

export interface LiveSelection extends LivePosition {
  line: number;
}

function channelAt(groups: Group[], position: LivePosition): Channel | undefined {
  return groups[position.group]?.channel[position.channel];
}

/** First channel of the first non-empty group, preferring groups after "收藏". */
function firstChannel(groups: Group[]): LiveSelection | undefined {
  let group = groups.findIndex((item, index) => index > 0 && item.channel.length > 0);
  if (group < 0 && (groups[0]?.channel.length ?? 0) > 0) group = 0;
  return group < 0 ? undefined : { group, channel: 0, line: 0 };
}

/**
 * Channel to start on: the route position when valid, else the saved keep
 * (LiveConfig.findKeepPosition), else the first channel; undefined when no
 * group has channels.
 */
export function initialSelection(
  groups: Group[],
  route: { groupIndex?: number; channelIndex?: number } | undefined,
  keep: string,
): LiveSelection | undefined {
  if (route?.groupIndex !== undefined) {
    const position = { group: route.groupIndex, channel: route.channelIndex ?? 0 };
    if (channelAt(groups, position)) return { ...position, line: 0 };
  }
  const saved = findKeepPosition(groups, keep);
  if (channelAt(groups, saved)) return saved;
  return firstChannel(groups);
}

/** "线路 n/m"; empty for a single-source channel. */
export function lineLabel(channel: Channel, line: number): string {
  return channel.urls.length > 1 ? `线路 ${line + 1}/${channel.urls.length}` : '';
}

/** Programme airing now and the one after it (Epg.getEpgData plus the next entry). */
export function nowAndNext(epg: Epg | undefined, now = Date.now()): { current?: EpgItem; next?: EpgItem } {
  if (!epg) return {};
  const index = currentProgrammeIndex(epg, now);
  if (index < 0) return {};
  return { current: epg.list[index], next: epg.list[index + 1] };
}

/** One entry of the group list: "全部", "收藏" (when it has channels), then every other group. */
export interface LiveGroupItem {
  key: string;
  name: string;
  count: number;
  kind: 'all' | 'keep' | 'group';
  groupIndex?: number;
}

/** A channel by its real position in `groups` (selection / route indices). */
export interface LiveChannelRef {
  group: number;
  channel: number;
}

export const ALL_GROUP_NAME = '全部';

/** Every channel of the non-keep groups in order; later duplicates (sameChannel) are dropped. */
function allChannelRefs(groups: Group[]): LiveChannelRef[] {
  const seen: Channel[] = [];
  const refs: LiveChannelRef[] = [];
  groups.forEach((group, groupIndex) => {
    if (isKeepGroup(group)) return;
    group.channel.forEach((channel, channelIndex) => {
      if (seen.some((item) => sameChannel(item, channel))) return;
      seen.push(channel);
      refs.push({ group: groupIndex, channel: channelIndex });
    });
  });
  return refs;
}

export function liveGroupItems(groups: Group[]): LiveGroupItem[] {
  const items: LiveGroupItem[] = [
    { key: 'all', name: ALL_GROUP_NAME, count: allChannelRefs(groups).length, kind: 'all' },
  ];
  const keepIndex = groups.findIndex(isKeepGroup);
  const keep = groups[keepIndex];
  if (keep && keep.channel.length > 0) {
    items.push({ key: 'keep', name: keep.name, count: keep.channel.length, kind: 'keep', groupIndex: keepIndex });
  }
  groups.forEach((group, groupIndex) => {
    if (isKeepGroup(group)) return;
    items.push({
      key: `group-${groupIndex}`,
      name: group.name,
      count: group.channel.length,
      kind: 'group',
      groupIndex,
    });
  });
  return items;
}

export function liveGroupChannels(groups: Group[], item: LiveGroupItem): LiveChannelRef[] {
  if (item.kind === 'all') return allChannelRefs(groups);
  const group = item.groupIndex === undefined ? undefined : groups[item.groupIndex];
  return (group?.channel ?? []).map((_, channel) => ({ group: item.groupIndex!, channel }));
}

/** The keep item when the selection is in the keep group, else "全部". */
export function itemForSelection(
  items: LiveGroupItem[],
  groups: Group[],
  selection: LivePosition | undefined,
): LiveGroupItem | undefined {
  const group = selection ? groups[selection.group] : undefined;
  if (group && isKeepGroup(group)) {
    const keep = items.find((item) => item.kind === 'keep');
    if (keep) return keep;
  }
  return items.find((item) => item.kind === 'all');
}

/** Channel number padded to two digits ("02"), else the 1-based list position. */
export function channelNumberLabel(channel: Channel, fallbackIndex: number): string {
  const number = channel.number.trim();
  if (/^\d+$/.test(number)) return String(Number(number)).padStart(2, '0');
  if (number !== '') return number;
  return String(fallbackIndex + 1).padStart(2, '0');
}

/** "HH:mm" start / end of a programme and how much of it has aired, clamped to [0, 1]. */
export function programmeProgress(
  item: EpgItem | undefined,
  now = Date.now(),
): { start: string; end: string; fraction: number } | undefined {
  if (!item || item.start === '' || item.end === '' || item.startTime <= 0 || item.endTime <= item.startTime) {
    return undefined;
  }
  const fraction = Math.min(1, Math.max(0, (now - item.startTime) / (item.endTime - item.startTime)));
  return { start: item.start, end: item.end, fraction };
}
