import { Text, View } from 'react-native';

import {
  AnimatedPressable,
  color,
  focus,
  FocusRing,
  fontFamily,
  Icon,
  radii,
  scaledText,
  useFocusAnimation,
  useScaledStyles,
  type Scaler,
} from '../../ui';

const COLUMNS = 6;
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890'.split('');
/** Width of the keyboard column in design px. */
export const KEYBOARD_WIDTH = 516;
const KEY_GAP = 12;
const KEY_SIZE = (KEYBOARD_WIDTH - KEY_GAP * (COLUMNS - 1)) / COLUMNS;

export interface KeyboardProps {
  onChar: (char: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  hasTVPreferredFocus?: boolean;
}

function Key({
  label,
  icon,
  span = 1,
  onPress,
  onLongPress,
  hasTVPreferredFocus,
  testID,
}: {
  label: string;
  icon?: 'backspace';
  span?: number;
  onPress: () => void;
  onLongPress?: () => void;
  hasTVPreferredFocus?: boolean;
  testID: string;
}) {
  const styles = useScaledStyles(makeStyles);
  const { focused, animatedStyle, handlers } = useFocusAnimation();
  const fg = focused ? color.inverseText : color.text;
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      {...handlers}
      style={[styles.key, span > 1 && styles.wide, focused && styles.focused, animatedStyle]}
    >
      {focused ? <FocusRing radius={styles.key.borderRadius} /> : null}
      {icon ? (
        <Icon name={icon} size={30} color={fg} />
      ) : (
        <Text style={[styles.label, span > 1 && styles.wideLabel, { color: fg }]}>{label}</Text>
      )}
    </AnimatedPressable>
  );
}

/** Search page keyboard: A-Z and 1-0 in six columns, then backspace (long press clears) and 清空. */
export function Keyboard({ onChar, onBackspace, onClear, hasTVPreferredFocus }: KeyboardProps) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View testID="search-keyboard" style={styles.grid}>
      {CHARS.map((char) => (
        <Key
          key={char}
          testID={`search-key-${char}`}
          label={char}
          hasTVPreferredFocus={hasTVPreferredFocus === true && char === 'A'}
          onPress={() => onChar(char)}
        />
      ))}
      <Key testID="search-key-backspace" label="删除" icon="backspace" onPress={onBackspace} onLongPress={onClear} />
      <Key testID="search-key-clear" label="清空" span={2} onPress={onClear} />
    </View>
  );
}

const makeStyles = (s: Scaler) => ({
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: s(KEY_GAP), width: s(KEYBOARD_WIDTH) },
  key: {
    width: s(KEY_SIZE),
    height: s(KEY_SIZE),
    borderRadius: s(radii.card),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: color.surface,
  },
  wide: { width: s(KEY_SIZE * 2 + KEY_GAP) },
  focused: { backgroundColor: focus.borderColor },
  label: scaledText(s).h2,
  wideLabel: { ...scaledText(s).body, fontFamily: fontFamily.semiBold },
});
