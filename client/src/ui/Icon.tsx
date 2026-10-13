import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';

import { useScale } from './scale';
import { color as palette } from './tokens';

interface IconDef {
  /** Stroked outline (default) or solid fill. */
  fill?: boolean;
  strokeWidth?: number;
  viewBox?: string;
  body: ReactNode;
}

// Paths copied from the inline SVGs of the design mockups; children inherit colour via currentColor.
const icons = {
  search: {
    body: (
      <>
        <Circle cx="11" cy="11" r="7" />
        <Path d="M20 20 L16.5 16.5" />
      </>
    ),
  },
  settings: {
    body: (
      <>
        <Circle cx="12" cy="12" r="3" />
        <Path d="M19.4 15 A7.8 7.8 0 0 0 19.5 9 L21.5 7.5 L19.5 4 L17.2 5 A7.8 7.8 0 0 0 14.6 3.5 L14 1 H10 L9.4 3.5 A7.8 7.8 0 0 0 6.8 5 L4.5 4 L2.5 7.5 L4.5 9 A7.8 7.8 0 0 0 4.6 15 L2.5 16.5 L4.5 20 L6.8 19 A7.8 7.8 0 0 0 9.4 20.5 L10 23 H14 L14.6 20.5 A7.8 7.8 0 0 0 17.2 19 L19.5 20 L21.5 16.5 Z" />
      </>
    ),
  },
  phone: {
    body: (
      <>
        <Rect x="7" y="2" width="10" height="20" rx="2.5" />
        <Path d="M11 18 H13" />
      </>
    ),
  },
  user: {
    body: (
      <>
        <Circle cx="12" cy="8" r="4" />
        <Path d="M4 21 C4 16.5 7.5 14 12 14 C16.5 14 20 16.5 20 21" />
      </>
    ),
  },
  /** Swap arrows for switching the site / source. */
  switch: { body: <Path d="M7 4 L3 8 L7 12 M3 8 H21 M17 12 L21 16 L17 20 M21 16 H3" /> },
  back: { strokeWidth: 2.4, body: <Path d="M15 6 L9 12 L15 18" /> },
  chevronRight: { strokeWidth: 2.4, body: <Path d="M9 6 L15 12 L9 18" /> },
  chevronDown: { strokeWidth: 2.6, body: <Path d="M6 9 L12 15 L18 9" /> },
  chevronUp: { strokeWidth: 2.6, body: <Path d="M6 15 L12 9 L18 15" /> },
  heart: { body: <Path d="M12 21 C7 16.5 3 13.3 3 8.8 A4.8 4.8 0 0 1 12 6 A4.8 4.8 0 0 1 21 8.8 C21 13.3 17 16.5 12 21 Z" /> },
  heartFilled: {
    body: (
      <Path
        fill="currentColor"
        d="M12 21 C7 16.5 3 13.3 3 8.8 A4.8 4.8 0 0 1 12 6 A4.8 4.8 0 0 1 21 8.8 C21 13.3 17 16.5 12 21 Z"
      />
    ),
  },
  play: { fill: true, body: <Path d="M7 4 L20 12 L7 20 Z" /> },
  pause: {
    fill: true,
    body: (
      <>
        <Rect x="6" y="4" width="4.5" height="16" rx="1" />
        <Rect x="13.5" y="4" width="4.5" height="16" rx="1" />
      </>
    ),
  },
  history: {
    body: (
      <>
        <Circle cx="12" cy="12" r="9" />
        <Path d="M12 7 V12 L15.5 14" />
      </>
    ),
  },
  star: { fill: true, body: <Path d="M12 2 L14.9 8.6 L22 9.3 L16.6 14 L18.2 21 L12 17.4 L5.8 21 L7.4 14 L2 9.3 L9.1 8.6 Z" /> },
  plus: { strokeWidth: 2.6, body: <Path d="M12 5 V19 M5 12 H19" /> },
  check: { strokeWidth: 2.6, body: <Path d="M5 12 L10 17 L19 7" /> },
  info: {
    body: (
      <>
        <Circle cx="12" cy="12" r="9" />
        <Path d="M12 11 V16 M12 8 V8.2" />
      </>
    ),
  },
  bookmark: { fill: true, body: <Path d="M5 3 H19 V21 L12 16 L5 21 Z" /> },
  share: { body: <Path d="M14 10 L14 4 L22 12 L14 20 L14 14 C8 14 5 16 2 20 C3 14 7 10 14 10 Z" /> },
  like: {
    body: (
      <Path d="M7 11 L7 21 M7 11 L11 3 C12.5 3 13.5 4 13.5 5.5 L13 9 L19 9 C20.5 9 21.5 10.3 21 11.8 L19.2 19.3 C19 20.3 18.1 21 17 21 L7 21 M2 11 L7 11 L7 21 L2 21 Z" />
    ),
  },
  mic: {
    body: (
      <>
        <Rect x="9" y="3" width="6" height="12" rx="3" />
        <Path d="M5 11 A7 7 0 0 0 19 11 M12 18 V21" />
      </>
    ),
  },
  backspace: {
    body: (
      <>
        <Path d="M9 5 H20 A2 2 0 0 1 22 7 V17 A2 2 0 0 1 20 19 H9 L2 12 Z" />
        <Path d="M12 9 L18 15 M18 9 L12 15" />
      </>
    ),
  },
  volume: {
    body: (
      <>
        <Path d="M4 10 V14 H8 L13 18 V6 L8 10 Z" />
        <Path d="M16 9 C17.5 10.5 17.5 13.5 16 15" />
        <Path d="M18.5 6.5 C21.5 9.5 21.5 14.5 18.5 17.5" />
      </>
    ),
  },
  /** Playback speed. */
  speed: {
    body: (
      <>
        <Path d="M5 4 L13 12 L5 20 Z" />
        <Path d="M13 4 L21 12 L13 20 Z" />
      </>
    ),
  },
  episodes: {
    body: (
      <>
        <Rect x="3" y="4" width="18" height="16" rx="3" />
        <Path d="M3 9 H21 M9 9 V20" />
      </>
    ),
  },
  subtitles: {
    body: (
      <>
        <Rect x="3" y="5" width="18" height="14" rx="3" />
        <Path d="M7 15 H13 M15 15 H17 M7 11 H9 M11 11 H17" />
      </>
    ),
  },
  skipNext: {
    fill: true,
    body: (
      <>
        <Path d="M5 5 L14.5 12 L5 19 Z" />
        <Path d="M15.5 5 H18 V19 H15.5 Z" />
      </>
    ),
  },
  skipPrevious: {
    fill: true,
    body: (
      <>
        <Path d="M6 5 H8.5 V19 H6 Z" />
        <Path d="M19 5 L9.5 12 L19 19 Z" />
      </>
    ),
  },
  replay10: {
    body: (
      <>
        <Path d="M4 12 A8 8 0 1 0 6.5 6.5" />
        <Path d="M4 4 V9 H9" />
        <SvgText x="8.5" y="15.5" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">
          10
        </SvgText>
      </>
    ),
  },
  forward10: {
    body: (
      <>
        <Path d="M20 12 A8 8 0 1 1 17.5 6.5" />
        <Path d="M20 4 V9 H15" />
        <SvgText x="8.5" y="15.5" fontSize="7" fontWeight="700" fill="currentColor" stroke="none">
          10
        </SvgText>
      </>
    ),
  },
  fullscreen: { strokeWidth: 2.4, body: <Path d="M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15" /> },
  /** App mark; render it with the accent colour. */
  logo: {
    viewBox: '0 0 40 40',
    strokeWidth: 3,
    body: (
      <>
        <Rect x="2" y="2" width="36" height="36" rx="10" />
        <Path d="M12 28 L20 12 L28 28" />
      </>
    ),
  },
} satisfies Record<string, IconDef>;

export type IconName = keyof typeof icons;
export const iconNames = Object.keys(icons) as IconName[];

export interface IconProps {
  name: IconName;
  /** Edge length in design px. */
  size?: number;
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Icon({ name, size = 24, color = palette.text, style, testID }: IconProps) {
  const { s } = useScale();
  const def: IconDef = icons[name];
  const edge = s(size);
  return (
    <Svg
      testID={testID}
      width={edge}
      height={edge}
      viewBox={def.viewBox ?? '0 0 24 24'}
      color={color}
      fill={def.fill ? 'currentColor' : 'none'}
      stroke={def.fill ? 'none' : 'currentColor'}
      strokeWidth={def.strokeWidth ?? 2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {def.body}
    </Svg>
  );
}
