import { useEffect, useState } from 'react';

import { getProvider, type SiteProvider, UnsupportedSiteError } from '../../core/provider';
import type { Class, Result, Site, Vod } from '../../core/types';

/** One horizontal row of the home page; its items open on `siteKey`. */
export interface HomeRow {
  key: string;
  title: string;
  items: Vod[];
  siteKey: string;
}

/**
 * What the home page shows. Every vod carries the site it opens with: rows through
 * HomeRow.siteKey, the featured banner through featuredSiteKey.
 */
export interface HomeContent {
  classes: Class[];
  featured: Vod[];
  featuredSiteKey: string;
  rows: HomeRow[];
}

/** Source of the home page; the screen only reads through this seam (one site today, aggregated later). */
export interface HomeContentProvider {
  /** Identity of the source, e.g. the site key. */
  readonly key: string;
  load(signal?: AbortSignal): Promise<HomeContent>;
}

export type HomeState =
  { status: 'loading' } | { status: 'ready'; content: HomeContent } | { status: 'error'; message: string };

export const FEATURED_MAX = 5;

/** The first FEATURED_MAX vods with a picture; the first FEATURED_MAX vods when none has one. */
export function pickFeatured(videos: readonly Vod[]): Vod[] {
  const withPic = videos.filter((vod) => vod.vod_pic);
  return (withPic.length > 0 ? withPic : videos).slice(0, FEATURED_MAX);
}

/** Key of the worker's recommendation home, whose classes are chart rows (worker/docs/plan/recommend-home.md). */
export const RECOMMEND_HOME_KEY = 'bk_home';

/** One row per class: the home list is the first class, the others load their first page; a failed or empty row is left out. */
async function chartRows(provider: SiteProvider, site: Site, home: Result): Promise<HomeRow[]> {
  const [first, ...rest] = home.class;
  if (!first) return [];
  const lists = await Promise.all(
    rest.map((cls) =>
      provider.category(cls.type_id, '1', false, {}).then(
        (result) => result.list,
        () => [],
      ),
    ),
  );
  return [first, ...rest]
    .map((cls, i) => ({ key: cls.type_id, title: cls.type_name, items: i === 0 ? home.list : lists[i - 1]!, siteKey: site.key }))
    .filter((row) => row.items.length > 0);
}

/** SiteViewModel.homeContent + homeVideoContent of `site`; the recommendation home shows every chart as a row. */
export function createSiteHomeContent(site: Site): HomeContentProvider {
  return {
    key: site.key,
    load: async () => {
      try {
        const provider = getProvider(site);
        if (site.key === RECOMMEND_HOME_KEY) {
          const home = await provider.home(false);
          const rows = await chartRows(provider, site, home);
          return { classes: home.class, featured: pickFeatured(rows[0]?.items ?? []), featuredSiteKey: site.key, rows };
        }
        const [home, video] = await Promise.all([provider.home(true), provider.homeVideo().catch(() => undefined)]);
        const videos = video && video.list.length > 0 ? video.list : home.list;
        const rows =
          videos.length > 0 ? [{ key: 'recommend', title: '热门推荐', items: videos, siteKey: site.key }] : [];
        return { classes: home.class, featured: pickFeatured(videos), featuredSiteKey: site.key, rows };
      } catch (error) {
        throw error instanceof UnsupportedSiteError
          ? new HomeContentError(`站点不支持：${site.name || site.key}`)
          : new HomeContentError(`加载失败：${error instanceof Error ? error.message : String(error)}`);
      }
    },
  };
}

/** Load failure whose message is shown as is. */
export class HomeContentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HomeContentError';
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof HomeContentError) return error.message;
  return `加载失败：${error instanceof Error ? error.message : String(error)}`;
}

/** Content of `provider`; reloads when the provider object changes or on retry, ignoring stale results. */
export function useHomeContent(provider: HomeContentProvider | undefined): [HomeState, () => void] {
  const [attempt, setAttempt] = useState(0);
  // The result of one request; a different provider or attempt reads as loading until its own result arrives.
  const [loaded, setLoaded] = useState<{ provider: HomeContentProvider; attempt: number; state: HomeState }>();

  useEffect(() => {
    if (!provider) return;
    const controller = new AbortController();
    provider.load(controller.signal).then(
      (content) => {
        if (!controller.signal.aborted) setLoaded({ provider, attempt, state: { status: 'ready', content } });
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setLoaded({ provider, attempt, state: { status: 'error', message: errorMessage(error) } });
      },
    );
    return () => controller.abort();
  }, [provider, attempt]);

  const state =
    loaded && loaded.provider === provider && loaded.attempt === attempt
      ? loaded.state
      : { status: 'loading' as const };
  return [state, () => setAttempt((n) => n + 1)];
}
