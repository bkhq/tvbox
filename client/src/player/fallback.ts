/**
 * Automatic line fallback, after playback/vod/VodFallbackPolicy.java
 * fallbackToNextLine: when the current line fails, move to the next line
 * (strictly after the current one) and play the same episode there, matched
 * like VodPlaybackController.seamless (same name, else same position).
 */

import type { Flag } from '../core/types';

export interface LineState {
  flags: Flag[];
  flagIndex: number;
  episodeIndex: number;
  /** Flag indices already tried for the current episode request. */
  tried: readonly number[];
}

export interface LineTarget {
  flagIndex: number;
  episodeIndex: number;
}

/** The next untried, non-empty line and the matching episode on it; undefined when none is left. */
export function nextLine(state: LineState): LineTarget | undefined {
  const name = state.flags[state.flagIndex]?.episodes[state.episodeIndex]?.name;
  for (let flagIndex = state.flagIndex + 1; flagIndex < state.flags.length; flagIndex++) {
    const episodes = state.flags[flagIndex]?.episodes ?? [];
    if (episodes.length === 0 || state.tried.includes(flagIndex)) continue;
    const byName = name === undefined ? -1 : episodes.findIndex((episode) => episode.name === name);
    const episodeIndex = byName >= 0 ? byName : Math.min(Math.max(state.episodeIndex, 0), episodes.length - 1);
    return { flagIndex, episodeIndex };
  }
  return undefined;
}

/** play_switch_flag in values-zh-rCN/strings.xml. */
export function switchLineNotice(flag: string): string {
  return `正在切换线路至「${flag}」`;
}
