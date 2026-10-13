import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useScaledStyles, type Scaler } from './scale';
import { color, radii } from './tokens';
import { fontFamily, scaledText } from './typography';

export type BadgeVariant = 'outline' | 'accent' | 'live';

export interface BadgeProps {
  label: string;
  /** outline: grey frame (4K / HDR); accent: accent frame and text (新片首播); live: red fill with a dot. */
  variant?: BadgeVariant;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** Grey frame of the quality tags in the detail mockup. */
const outlineBorder = '#5A6578';
const liveText = '#FFFFFF';

export function Badge({ label, variant = 'outline', style, testID }: BadgeProps) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View testID={testID} style={[styles.badge, styles[variant], style]}>
      {variant === 'live' ? <View style={styles.dot} /> : null}
      <Text numberOfLines={1} style={[styles.label, styles[`${variant}Label`]]}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const { caption } = scaledText(s);
  return {
    badge: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      alignSelf: 'flex-start' as const,
      gap: s(8),
      paddingVertical: s(4),
      paddingHorizontal: s(10),
      borderRadius: s(radii.tag),
    },
    outline: { borderWidth: s(2), borderColor: outlineBorder, paddingVertical: s(2) },
    accent: { borderWidth: s(2), borderColor: color.accent, paddingHorizontal: s(12) },
    live: { backgroundColor: color.live },
    dot: { width: s(8), height: s(8), borderRadius: s(4), backgroundColor: liveText },
    label: { ...caption, lineHeight: s(24) },
    outlineLabel: { fontFamily: fontFamily.semiBold, color: color.text },
    accentLabel: { fontFamily: fontFamily.bold, color: color.accent, letterSpacing: s(1.6) },
    liveLabel: { fontFamily: fontFamily.bold, color: liveText, letterSpacing: s(2) },
  };
};
