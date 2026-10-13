import { useMemo } from 'react';
import { PixelRatio, StyleSheet, useWindowDimensions } from 'react-native';

/** Width of the 1080p design canvas that every token is measured against. */
export const DESIGN_WIDTH = 1920;

/** Converts design px to device dp. */
export type Scaler = (designPx: number) => number;

/** dp per design px for a window width, on TV and phone alike. */
export function scaleFor(windowWidth: number): number {
  return windowWidth / DESIGN_WIDTH;
}

export function makeScaler(scale: number): Scaler {
  return (designPx) => PixelRatio.roundToNearestPixel(designPx * scale);
}

export function useScale(): { scale: number; s: Scaler } {
  const { width } = useWindowDimensions();
  return useMemo(() => {
    const scale = scaleFor(width);
    return { scale, s: makeScaler(scale) };
  }, [width]);
}

/** StyleSheet built from design px, rebuilt only when the scale changes. */
export function useScaledStyles<T extends StyleSheet.NamedStyles<T>>(factory: (s: Scaler) => T): T {
  const { s } = useScale();
  // The factory is usually an inline arrow; keying on it would rebuild the sheet every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => StyleSheet.create(factory(s)), [s]);
}
