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
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function SectionHeader({ title, caption, captionPosition = 'right', style, testID }: SectionHeaderProps) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View testID={testID} style={[captionPosition === 'right' ? styles.row : styles.column, style]}>
      <Text numberOfLines={1} style={styles.title}>
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
    caption: { ...text.caption, fontSize: s(22), lineHeight: s(30), color: color.text3 },
  };
};
