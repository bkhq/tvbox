import type { Result, Site, Vod } from '../../core/types';

export interface SiteGroup {
  site: Site;
  list: Vod[];
}

export interface SearchProgress {
  /** Sites with results, in target order. */
  groups: SiteGroup[];
  /** Sites that answered, failed or timed out. */
  completed: number;
  total: number;
  done: boolean;
}

export interface SearchOptions {
  /** Sites searched at the same time. */
  concurrency?: number;
  /** Per-site limit in milliseconds (Constant.TIMEOUT_SEARCH). */
  timeoutMs?: number;
  /** Answers within this window share one update, so the grid re-renders once; 0 updates per site. */
  intervalMs?: number;
}

export interface SearchHandle {
  /** Stops launching sites and drops every later update. */
  cancel(): void;
  /** Settles once every launched site has finished. */
  done: Promise<void>;
}

export const SEARCH_CONCURRENCY = 5;
export const SEARCH_TIMEOUT_MS = 30_000;
export const SEARCH_UPDATE_MS = 300;

/** Supported, searchable sites; quick mode also requires quickSearch (SiteViewModel.SearchTask). */
export function searchTargets(sites: readonly Site[], quick: boolean): Site[] {
  return sites.filter((site) => site.supported && site.searchable === 1 && (!quick || site.quickSearch === 1));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('search timeout')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Searches `targets` with at most `concurrency` sites in flight. A failing or
 * slow site counts as an empty answer, so it never fails the whole search.
 * `onUpdate` receives the aggregated progress immediately, then at most once per
 * `intervalMs` while sites answer, and at once when the last site has answered.
 */
export function searchSites(
  targets: readonly Site[],
  search: (site: Site) => Promise<Result>,
  onUpdate: (progress: SearchProgress) => void,
  { concurrency = SEARCH_CONCURRENCY, timeoutMs = SEARCH_TIMEOUT_MS, intervalMs = SEARCH_UPDATE_MS }: SearchOptions = {},
): SearchHandle {
  const total = targets.length;
  const lists: (Vod[] | undefined)[] = new Array(total);
  let cancelled = false;
  let next = 0;
  let completed = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const emit = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (cancelled) return;
    const groups: SiteGroup[] = [];
    targets.forEach((site, index) => {
      const list = lists[index];
      if (list && list.length > 0) groups.push({ site, list });
    });
    onUpdate({ groups, completed, total, done: completed === total });
  };

  const worker = async () => {
    while (!cancelled && next < total) {
      const index = next++;
      let list: Vod[] = [];
      try {
        // Defers the call so a synchronous throw (e.g. UnsupportedSiteError) stays isolated too.
        const result = await withTimeout(
          Promise.resolve().then(() => search(targets[index]!)),
          timeoutMs,
        );
        list = result.list;
      } catch {
        list = [];
      }
      if (cancelled) return;
      lists[index] = list;
      completed++;
      if (completed === total || intervalMs <= 0) emit();
      else if (timer === undefined) timer = setTimeout(emit, intervalMs);
    }
  };

  emit();
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), total) }, worker);
  return {
    cancel: () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    },
    done: Promise.all(workers).then(() => undefined),
  };
}
