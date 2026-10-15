import { Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useScaledStyles, type Scaler } from './scale';
import { color } from './tokens';
import { scaledText } from './typography';

export interface SectionHeaderProps {
  title: string;
  /** Secondary note, e.g. an item count. */
  caption?: string;
  /** Beside the title on the baseline (home rows) or underneath it. */
  captionPosition?: 'right' | 'below';
  /** h2: row titles; h1: page section titles. */
  variant?: 'h2' | 'h1';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SectionHeader({
  title,
  caption,
  captionPosition = 'right',
  variant = 'h2',
  style,
  testID,
}: SectionHeaderProps) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View testID={testID} style={[captionPosition === 'right' ? styles.row : styles.column, style]}>
      <Text numberOfLines={1} style={[styles.title, variant === 'h1' && styles.titleH1]}>
        {title}
      </Text>
      {caption ? (
        <Text numberOfLines={1} style={styles.caption}>
          {caption}
        </Text>
      ) : null}
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    row: { flexDirection: 'row' as const, alignItems: 'baseline' as const, gap: s(16) },
    column: { gap: s(8) },
    title: { ...text.h2, color: color.text },
    titleH1: text.h1,
    caption: { ...text.caption, color: color.text3 },
  };
};
