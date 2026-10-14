// Design tokens in 1080p design pixels (1920x1080). Scale them to dp with `s` from ./scale.

export const color = {
  bg: '#0B0E14',
  surface: '#151A24',
  surface2: '#1E2532',
  text: '#F2F4F8',
  text2: '#AEB7C7',
  text3: '#8C96A8',
  accent: '#F2B134',
  live: '#C8313B',
  /** Hairline dividers and panel outlines. */
  divider: '#2A3240',
  /** Stronger outline, e.g. placeholder boxes. */
  border: '#3A4556',
  /** Unfocused button fill: 14% white. */
  buttonFill: 'rgba(255,255,255,0.14)',
  focusBorder: '#FFFFFF',
  /** Text on a focused (white) button or on the accent fill. */
  inverseText: '#0B0E14',
  /** Drop shadow under a focused card. */
  shadow: 'rgba(0,0,0,0.55)',
} as const;

/** Font size, line height (px) and weight per text role. */
export const type = {
  display: { fontSize: 88, lineHeight: 88, fontWeight: 700 },
  displaySm: { fontSize: 72, lineHeight: 72, fontWeight: 700 },
  h1: { fontSize: 44, lineHeight: 52, fontWeight: 700 },
  h2: { fontSize: 36, lineHeight: 46, fontWeight: 600 },
  body: { fontSize: 32, lineHeight: 44, fontWeight: 500 },
  label: { fontSize: 28, lineHeight: 38, fontWeight: 500 },
  caption: { fontSize: 24, lineHeight: 32, fontWeight: 400 },
} as const;

export const space = { xs: 8, sm: 16, md: 24, lg: 40, xl: 64, xxl: 96 } as const;

export const radii = { tag: 6, card: 10, button: 14, round: 9999 } as const;

export const safeArea = { horizontal: 96, vertical: 56 } as const;

export const focus = {
  scale: 1.08,
  pressedScale: 1.02,
  borderWidth: 4,
  borderColor: color.focusBorder,
  springMs: 180,
  /** Room a row container leaves around its cards so the focus zoom is not clipped. */
  bleed: 16,
  /** Focused button: a bg-coloured gap, then a white ring of the same width. */
  ringGap: 4,
  ringWidth: 4,
} as const;

export const card = {
  poster: { width: 224, height: 336 },
  wide: { width: 352, height: 198 },
  channel: { width: 160, height: 90 },
  rowGap: 24,
  posterColumns: 7,
  wideColumns: 5,
} as const;

export const tokens = { color, type, space, radii, safeArea, focus, card } as const;
export type Tokens = typeof tokens;
