import type { TextStyle } from 'react-native';

import type { Scaler } from './scale';
import { type } from './tokens';

// Per-weight families of the bundled Outfit files (assets/fonts, embedded by the expo-font plugin).
// No fontWeight is set, so Android never synthesises a weight; CJK glyphs fall back to the system font.
export const fontFamily = { medium: 'Outfit-Medium', semiBold: 'Outfit-SemiBold', bold: 'Outfit-Bold' } as const;

// Regular (400) is not bundled; caption uses Medium.
const familyByWeight: Record<number, string> = {
  400: fontFamily.medium,
  500: fontFamily.medium,
  600: fontFamily.semiBold,
  700: fontFamily.bold,
};

export type TextVariant = keyof typeof type;

function preset(variant: TextVariant): TextStyle {
  const { fontSize, lineHeight, fontWeight } = type[variant];
  return { fontFamily: familyByWeight[fontWeight], fontSize, lineHeight };
}

/** Text presets in design px; scale them with `scaledText(s)`. */
export const text: Record<TextVariant, TextStyle> = {
  display: preset('display'),
  displaySm: preset('displaySm'),
  h1: preset('h1'),
  h2: preset('h2'),
  body: preset('body'),
  label: preset('label'),
  caption: preset('caption'),
};

/** Fixed-width digits for times, counts and progress. */
export const tabular: TextStyle = { fontVariant: ['tabular-nums'] };

export function scaledText(s: Scaler): Record<TextVariant, TextStyle> {
  const scaled = {} as Record<TextVariant, TextStyle>;
  for (const variant of Object.keys(text) as TextVariant[]) {
    const style = text[variant];
    scaled[variant] = { ...style, fontSize: s(style.fontSize!), lineHeight: s(style.lineHeight!) };
  }
  return scaled;
}
