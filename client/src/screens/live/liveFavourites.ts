import type { Channel, Group } from '../../core/types';
import type { KeepRepository } from '../../core/storage/keep';
import { getKeepRepository } from '../../core/userData';
import { isKeepGroup } from '../../player/live';
import { sameChannel } from '../../player/live/channel';

/** The "收藏" group, which loadLive puts first. */
function keepGroup(groups: Group[]): Group | undefined {
  const group = groups[0];
  return group && isKeepGroup(group) ? group : undefined;
}

function isKept(keep: Group, channel: Channel): boolean {
  return keep.channel.some((item) => sameChannel(item, channel) || item.name === channel.name);
}

export function isFavourite(groups: Group[], channel: Channel): boolean {
  const keep = keepGroup(groups);
  return keep ? isKept(keep, channel) : false;
}

/** Copies of every same-named channel merged into one, as load.ts applyKeeps builds the keep group. */
function keepCopy(groups: Group[], channel: Channel): Channel {
  const sources = groups.filter((group) => !isKeepGroup(group)).flatMap((group) => group.channel);
  const matches = sources.filter((item) => item.name === channel.name);
  const [first, ...rest] = matches.length > 0 ? matches : [channel];
  return { ...first!, urls: [...first!.urls, ...rest.flatMap((item) => item.urls)] };
}

/**
 * Adds or removes the live keep (type 1, keyed by channel name) and returns a
 * new groups array whose keep group gains or loses the channel. The input is
 * not mutated; without a keep group only the stored keep changes.
 */
export async function toggleFavourite(
  groups: Group[],
  channel: Channel,
  repo: KeepRepository = getKeepRepository(),
): Promise<{ groups: Group[]; favourite: boolean }> {
  const keep = keepGroup(groups);
  const favourite = !(keep ? isKept(keep, channel) : await repo.isKept(channel.name, 0, 1));
  if (favourite) {
    await repo.add({ type: 1, cid: 0, key: channel.name, vodName: channel.name, vodPic: channel.logo, siteName: '' });
  } else {
    await repo.remove(channel.name, 0, 1);
  }
  if (!keep) return { groups: [...groups], favourite };
  const next = favourite
    ? [...keep.channel, keepCopy(groups, channel)]
    : keep.channel.filter((item) => !(sameChannel(item, channel) || item.name === channel.name));
  return { groups: [{ ...keep, channel: next }, ...groups.slice(1)], favourite };
}
