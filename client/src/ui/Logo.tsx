import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Icon } from './Icon';
import { useScaledStyles, type Scaler } from './scale';
import { color } from './tokens';
import { fontFamily } from './typography';

export interface LogoProps {
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** App mark and wordmark at the left of the top bar. */
export function Logo({ style, testID }: LogoProps) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View testID={testID} accessibilityRole="header" style={[styles.logo, style]}>
      <Icon name="logo" size={48} color={color.accent} />
      <Text style={styles.word}>星幕</Text>
    </View>
  );
}

const makeStyles = (s: Scaler) => ({
  logo: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(12) },
  // letter-spacing 0.06em of the wordmark.
  word: {
    fontFamily: fontFamily.bold,
    fontSize: s(42),
    lineHeight: s(48),
    letterSpacing: s(42) * 0.06,
    color: color.text,
  },
});
