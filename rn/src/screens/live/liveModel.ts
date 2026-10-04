import type { Channel, Group } from '../../core/types';
import { currentProgrammeIndex, type Epg, type EpgItem, findKeepPosition, type LivePosition } from '../../player/live';

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
