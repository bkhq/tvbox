import { color, focus, radii, space, type } from './tokens';

// Legacy dp values for static StyleSheets: design px at the TV baseline (1920 px -> 960 dp).
const dp = (designPx: number) => Math.round(designPx / 2);

export const colors = {
  background: color.bg,
  surface: color.surface,
  surfaceFocused: color.surface2,
  primary: color.accent,
  text: color.text,
  textSecondary: color.text2,
  border: 'transparent',
  focusBorder: color.focusBorder,
  remarkBackground: 'rgba(0, 0, 0, 0.6)',
} as const;

export const spacing = {
  xs: dp(space.xs),
  sm: dp(space.sm),
  md: dp(space.md),
  lg: dp(space.lg),
  xl: dp(space.xl),
} as const;

export const fontSize = {
  caption: dp(type.caption.fontSize),
  body: dp(type.body.fontSize),
  title: dp(type.h2.fontSize),
  heading: dp(type.h1.fontSize),
  display: dp(type.displaySm.fontSize),
} as const;

export const radius = { sm: dp(radii.tag), md: dp(radii.card) } as const;

/** Scale applied to a focused card or button. */
export const focusScale = focus.scale;

export const theme = { colors, spacing, fontSize, radius, focusScale } as const;
export type Theme = typeof theme;
