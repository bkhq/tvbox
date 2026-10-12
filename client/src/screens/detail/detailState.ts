import { type HistoryInput, TIME_UNSET } from '../../core/storage';
import type { Episode, Flag, History, Vod } from '../../core/types';
import type { RootStackParamList } from '../../navigation/types';

export interface ResumeTarget {
  /** Index into the flags; 0 when the saved flag is gone. */
  flagIndex: number;
  revSort: boolean;
  /** Saved episode, only when its flag and url still exist. */
  episode?: Episode;
}

/** VideoActivity history restore: saved flag and episode when they still exist, plus the sort order. */
export function resolveResume(flags: readonly Flag[], history: History | undefined): ResumeTarget {
  if (!history) return { flagIndex: 0, revSort: false };
  const flagIndex = flags.findIndex((flag) => flag.flag === history.vodFlag);
  if (flagIndex < 0) return { flagIndex: 0, revSort: history.revSort };
  const episode = flags[flagIndex]!.episodes.find((item) => item.url === history.episodeUrl);
  return { flagIndex, revSort: history.revSort, episode };
}

/** Episodes in display order. */
export function sortEpisodes(episodes: readonly Episode[], revSort: boolean): Episode[] {
  return revSort ? [...episodes].reverse() : [...episodes];
}

export interface PlayInput {
  key: string;
  cid: number;
  vod: Pick<Vod, 'vod_name' | 'vod_pic'>;
  flag: string;
  episode: Episode;
  revSort: boolean;
  existing?: History;
}

/** History upsert for playing `episode`; the saved position survives only for the same episode. */
export function buildHistoryInput({ key, cid, vod, flag, episode, revSort, existing }: PlayInput): HistoryInput {
  const sameEpisode = existing !== undefined && existing.vodFlag === flag && existing.episodeUrl === episode.url;
  return {
    key,
    cid,
    vodName: vod.vod_name,
    vodPic: vod.vod_pic,
    vodFlag: flag,
    vodRemarks: episode.name,
    episodeUrl: episode.url,
    revSort,
    position: sameEpisode ? existing.position : TIME_UNSET,
  };
}

export function buildPlayerParams(
  siteKey: string,
  vodId: string,
  flag: string,
  episode: Episode,
  position: number = TIME_UNSET,
): RootStackParamList['Player'] {
  const params: RootStackParamList['Player'] = {
    siteKey,
    vodId,
    flag,
    episodeUrl: episode.url,
  };
  if (position > TIME_UNSET) params.position = position;
  return params;
}
