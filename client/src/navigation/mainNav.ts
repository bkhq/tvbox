import { useCallback, useMemo, useSyncExternalStore } from 'react';

import type { RootStackParamList } from './types';
import { useAppNavigation } from './useAppNavigation';

export type MainNavKey = 'home' | 'series' | 'movie' | 'live' | 'profile';

type MainNavTarget =
  { route: 'Home'; params: NonNullable<RootStackParamList['Home']> } | { route: 'Live' } | { route: 'Settings' };

export type MainNavTab = { key: MainNavKey; label: string } & MainNavTarget;

/** Item of the top navigation as rendered by TopNav. */
export interface MainNavItem {
  key: MainNavKey;
  label: string;
  active: boolean;
}

// Home gets explicit (empty) params so navigating back to it clears a previous section.
export const mainNavTabs: readonly MainNavTab[] = [
  { key: 'home', label: '首页', route: 'Home', params: {} },
  { key: 'series', label: '剧集', route: 'Home', params: { section: 'series' } },
  { key: 'movie', label: '电影', route: 'Home', params: { section: 'movie' } },
  { key: 'live', label: '直播', route: 'Live' },
  { key: 'profile', label: '我的', route: 'Settings' },
];

/** Which optional tabs the home site supports; both are shown until the browse workstream knows better. */
export interface MainNavAvailability {
  series: boolean;
  movie: boolean;
}

let availability: MainNavAvailability = { series: true, movie: true };
const listeners = new Set<() => void>();

export function getMainNavAvailability(): MainNavAvailability {
  return availability;
}

export function setMainNavAvailability(next: Partial<MainNavAvailability>): void {
  const merged = { ...availability, ...next };
  if (merged.series === availability.series && merged.movie === availability.movie) return;
  availability = merged;
  listeners.forEach((listener) => listener());
}

export function subscribeMainNavAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMainNav(active: MainNavKey): { items: MainNavItem[]; select: (key: MainNavKey) => void } {
  const navigation = useAppNavigation();
  const { series, movie } = useSyncExternalStore(subscribeMainNavAvailability, getMainNavAvailability);

  const items = useMemo(
    () =>
      mainNavTabs
        .filter((tab) => (tab.key === 'series' ? series : tab.key === 'movie' ? movie : true))
        .map(({ key, label }) => ({ key, label, active: key === active })),
    [active, series, movie],
  );

  const select = useCallback(
    (key: MainNavKey) => {
      if (key === active) return;
      const tab = mainNavTabs.find((t) => t.key === key);
      if (!tab) return;
      if (tab.route === 'Home') navigation.navigate('Home', tab.params);
      else navigation.navigate(tab.route);
    },
    [active, navigation],
  );

  return { items, select };
}
