export const colors = {
  background: '#0b0b0f',
  surface: '#1c1c22',
  surfaceFocused: '#2c2c36',
  primary: '#3d8bfd',
  text: '#ffffff',
  textSecondary: '#a0a0ab',
  border: 'transparent',
  focusBorder: '#ffffff',
  remarkBackground: 'rgba(0, 0, 0, 0.6)',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const fontSize = {
  caption: 12,
  body: 14,
  title: 16,
  heading: 20,
  display: 28,
} as const;

export const radius = {
  sm: 4,
  md: 8,
} as const;

/** Scale applied to a focused card or button. */
export const focusScale = 1.08;

export const theme = { colors, spacing, fontSize, radius, focusScale } as const;
export type Theme = typeof theme;
