/**
 * Playback history: resume and progress writes on the (cid, key) record that
 * Detail creates (playback/vod/VodHistoryPolicy.java). The record is created
 * here only when missing; nothing is written while `incognito` is on.
 */

import { type HistoryInput, type HistoryRepository, TIME_UNSET } from '../core/storage';
import type { Episode, Flag, History } from '../core/types';

/** Minimum gap between periodic progress writes (History.canScheduleSave). */
export const SAVE_INTERVAL = 5_000;

/** Episode.matchesName against the record's episode, falling back to its URL. */
export function matchesEpisode(history: Pick<History, 'vodRemarks' | 'episodeUrl'>, episode: Episode): boolean {
  if (history.vodRemarks !== '' && history.vodRemarks.toLowerCase() === episode.name.toLowerCase()) return true;
  return history.episodeUrl !== '' && history.episodeUrl === episode.url;
}

export interface EpisodeHint {
  flag?: string;
  episodeUrl?: string;
}

function findIn(flags: Flag[], flagName: string | undefined, match: (episode: Episode) => boolean) {
  const preferred = flags.findIndex((flag) => flag.flag === flagName);
  const order = preferred >= 0 ? [preferred, ...flags.keys()] : [...flags.keys()];
  for (const flagIndex of order) {
    const episodeIndex = flags[flagIndex]!.episodes.findIndex(match);
    if (episodeIndex >= 0) return { flagIndex, episodeIndex };
  }
  return preferred >= 0 ? { flagIndex: preferred, episodeIndex: 0 } : undefined;
}

/** Episode to start with: route hint, then the history record, then the first one. */
export function pickEpisode(flags: Flag[], hint: EpisodeHint, history?: History): { flagIndex: number; episodeIndex: number } {
  if (hint.flag !== undefined || hint.episodeUrl !== undefined) {
    const found = findIn(flags, hint.flag, (episode) => episode.url === hint.episodeUrl);
    if (found) return found;
  }
  if (history) {
    const found = findIn(flags, history.vodFlag, (episode) => matchesEpisode(history, episode));
    if (found) return found;
  }
  return { flagIndex: 0, episodeIndex: 0 };
}

/**
 * VodHistoryPolicy.startPositionMs: the larger of the opening skip and the
 * resume position. The record's position only counts for its own episode;
 * `override` (route param) replaces it. Undefined means start at 0.
 */
export function startPosition(history: History | undefined, episode: Episode, override?: number): number | undefined {
  const resume = override ?? (history && matchesEpisode(history, episode) ? history.position : TIME_UNSET);
  const start = Math.max(history?.opening ?? TIME_UNSET, resume);
  return start > 0 ? start : undefined;
}

/** VodPlaybackController.onTimeChanged: the ending skip is reached. */
export function shouldSkipEnding(history: Pick<History, 'ending'> | undefined, position: number, duration: number): boolean {
  return !!history && history.ending > 0 && duration > 0 && history.ending + position >= duration;
}

export interface HistoryTrackerOptions {
  repo: HistoryRepository;
  cid: number;
  key: string;
  /** False while incognito. */
  enabled(): boolean;
  now?: () => number;
}

export interface HistoryTracker {
  /** Loads the record, creating it when missing. */
  open(vod: { vodName: string; vodPic?: string }): Promise<History | undefined>;
  current(): History | undefined;
  /** Saves pending progress, then points the record at a new episode (VodHistoryPolicy.updateEpisode). */
  setEpisode(flag: string, episode: Episode): Promise<void>;
  /** Records progress; writes at most every SAVE_INTERVAL. */
  progress(position: number, duration: number): Promise<void>;
  setSpeed(speed: number): Promise<void>;
  /** Writes the current progress now (pause, stop, episode change). */
  flush(): Promise<void>;
}

export function createHistoryTracker(options: HistoryTrackerOptions): HistoryTracker {
  const { repo, cid, key, enabled } = options;
  const now = options.now ?? Date.now;
  let record: History | undefined;
  let lastSave = 0;
  let writes: Promise<unknown> = Promise.resolve();

  const write = (fields: Omit<HistoryInput, 'key' | 'cid'>): Promise<void> => {
    if (!enabled()) return writes.then(() => undefined);
    writes = writes.catch(() => undefined).then(() => repo.upsert({ key, cid, ...fields }));
    return writes.then(() => undefined);
  };

  const canSave = (item: History) => item.position >= 0 && item.duration > 0;

  const flush = (): Promise<void> => {
    if (!record || !canSave(record)) return writes.then(() => undefined);
    lastSave = now();
    return write({ position: record.position, duration: record.duration, speed: record.speed });
  };

  return {
    async open(vod) {
      const existing = await repo.get(cid, key);
      if (existing) {
        record = { ...existing };
      } else if (enabled()) {
        record = await repo.upsert({ key, cid, vodName: vod.vodName, vodPic: vod.vodPic ?? '' });
      }
      return record;
    },
    current: () => record,
    async setEpisode(flag, episode) {
      await flush();
      if (!record) return;
      const same = matchesEpisode(record, episode);
      const reset = same ? {} : { position: TIME_UNSET, duration: TIME_UNSET };
      record = { ...record, ...reset, vodFlag: flag, vodRemarks: episode.name, episodeUrl: episode.url };
      await write({ ...reset, vodFlag: flag, vodRemarks: episode.name, episodeUrl: episode.url });
    },
    async progress(position, duration) {
      if (!record || position < 0 || duration <= 0) return;
      record = { ...record, position, duration };
      if (now() - lastSave >= SAVE_INTERVAL) await flush();
    },
    async setSpeed(speed) {
      if (!record) return;
      record = { ...record, speed };
      await write({ speed });
    },
    flush,
  };
}
