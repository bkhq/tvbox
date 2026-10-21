import type { NavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from '../navigation/types';
import type { LanNavigator } from './ports';

/** The app's navigation container; App.tsx binds it once the container is ready. */
let container: NavigationContainerRef<RootStackParamList> | null = null;

export function bindLanNavigation(ref: NavigationContainerRef<RootStackParamList> | null): void {
  container = ref;
}

/** Search and Player routes for /api/search and /api/play; no-ops before the container is ready. */
export function createLanNavigator(): LanNavigator {
  return {
    search(word) {
      if (container?.isReady()) container.navigate('Search', { keyword: word });
    },
    play(params) {
      if (container?.isReady()) container.navigate('Player', params);
    },
  };
}
