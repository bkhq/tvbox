import { Platform, useWindowDimensions } from 'react-native';

export interface Layout {
  isTV: boolean;
  isPhone: boolean;
  isTablet: boolean;
  /** Poster grid column count for the current window. */
  columns: number;
  /** Multiplier for sizes designed against a 960dp-wide TV / phone baseline. */
  scale: number;
}

const TABLET_MIN_SHORT_SIDE = 600;
const TV_BASE_WIDTH = 960;

export function computeLayout(width: number, height: number, isTV: boolean): Layout {
  const isTablet = !isTV && Math.min(width, height) >= TABLET_MIN_SHORT_SIDE;
  const isPhone = !isTV && !isTablet;
  const landscape = width > height;
  let columns: number;
  if (isTV) columns = 6;
  else if (isTablet) columns = landscape ? 6 : 4;
  else columns = landscape ? 5 : 3;
  const scale = isTV ? Math.max(1, width / TV_BASE_WIDTH) : 1;
  return { isTV, isPhone, isTablet, columns, scale };
}

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  return computeLayout(width, height, Platform.isTV);
}
