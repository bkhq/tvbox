import { useCallback, useEffect, useState } from 'react';

import { splitHistoryKey } from '../../core/storage';
import type { History } from '../../core/types';
import { getHistoryRepository } from '../../core/userData';
import { useActiveCid } from '../common/useSite';

export const CONTINUE_WATCHING_MAX = 20;

/** The part of the navigation object useContinueWatching needs. */
export interface FocusSource {
  addListener(event: 'focus', listener: () => void): () => void;
}

/**
 * History of the active config, newest first, at most CONTINUE_WATCHING_MAX items.
 * Re-reads when `navigation` fires focus, or on `refresh`.
 */
export function useContinueWatching(navigation?: FocusSource): { items: History[]; refresh: () => void } {
  const cid = useActiveCid();
  const [version, setVersion] = useState(0);
  const [loaded, setLoaded] = useState<{ cid: number; items: History[] }>();
  const refresh = useCallback(() => setVersion((n) => n + 1), []);

  useEffect(() => navigation?.addListener('focus', refresh), [navigation, refresh]);

  useEffect(() => {
    if (cid === undefined) return;
    let active = true;
    getHistoryRepository()
      .list(cid)
      .then(
        (records) => active && setLoaded({ cid, items: records.slice(0, CONTINUE_WATCHING_MAX) }),
        () => active && setLoaded({ cid, items: [] }),
      );
    return () => {
      active = false;
    };
  }, [cid, version]);

  // Keep the previous list while re-reading the same config so the row does not flash.
  return { items: loaded && loaded.cid === cid ? loaded.items : [], refresh };
}

const known = (history: History) => history.position > 0 && history.duration > 0;

/** Watched fraction 0..1, or undefined when position or duration is unknown (TIME_UNSET). */
export function progressOf(history: History): number | undefined {
  if (!known(history)) return undefined;
  return Math.min(1, Math.max(0, history.position / history.duration));
}

/** "剩余 N 分钟" / "剩余 H 小时 M 分钟" from the millisecond position and duration, rounded up to the minute. */
export function remainingText(history: History): string | undefined {
  if (!known(history)) return undefined;
  const minutes = Math.ceil(Math.max(0, history.duration - history.position) / 60000);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `剩余 ${hours} 小时 ${minutes % 60} 分钟` : `剩余 ${minutes} 分钟`;
}

/** Episode name and remaining time joined by " · ", omitting missing parts. */
export function subtitleOf(history: History): string {
  return [history.vodRemarks, remainingText(history)].filter(Boolean).join(' · ');
}

export const siteKeyOf = (history: History): string => splitHistoryKey(history.key).siteKey;

export const vodIdOf = (history: History): string => splitHistoryKey(history.key).vodId;
