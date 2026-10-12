import { useNavigation } from '@react-navigation/native';

import type { AppNavigation } from './types';

/** Typed navigation for any screen or component inside the root stack. */
export function useAppNavigation(): AppNavigation {
  return useNavigation<AppNavigation>();
}
