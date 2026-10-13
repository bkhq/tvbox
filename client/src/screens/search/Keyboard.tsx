import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../../ui';

const COLUMNS = 6;
const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

export interface KeyboardProps {
  /** Width of one key; keys are square. */
  keySize: number;
  quick: boolean;
  onChar: (char: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onToggleQuick: () => void;
  onSearch: () => void;
  hasTVPreferredFocus?: boolean;
}

function Key({
  label,
  span = 1,
  size,
  selected,
  onPress,
  onLongPress,
  hasTVPreferredFocus,
  testID,
}: {
  label: string;
  span?: number;
  size: number;
  selected?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  hasTVPreferredFocus?: boolean;
  testID: string;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.key,
        { width: size * span + KEY_GAP * 2 * (span - 1), height: size },
        selected && styles.selected,
        focused && styles.focused,
      ]}
    >
      <Text style={[styles.label, focused && styles.focusedLabel]}>{label}</Text>
    </Pressable>
  );
}

const KEY_GAP = spacing.xs / 2;

/** SearchActivity's on-screen keyboard: edit keys on top, then A-Z and 0-9. */
export function Keyboard({
  keySize,
  quick,
  onChar,
  onBackspace,
  onClear,
  onToggleQuick,
  onSearch,
  hasTVPreferredFocus,
}: KeyboardProps) {
  const rows: string[][] = [];
  for (let i = 0; i < CHARS.length; i += COLUMNS) rows.push(CHARS.slice(i, i + COLUMNS));
  return (
    <View testID="search-keyboard">
      <View style={styles.row}>
        <Key testID="search-key-clear" label="清空" size={keySize} onPress={onClear} />
        <Key testID="search-key-backspace" label="⌫" size={keySize} onPress={onBackspace} onLongPress={onClear} />
        <Key testID="search-quick" label="快速" span={2} size={keySize} selected={quick} onPress={onToggleQuick} />
        <Key testID="search-submit" label="搜索" span={2} size={keySize} onPress={onSearch} />
      </View>
      {rows.map((row) => (
        <View key={row[0]} style={styles.row}>
          {row.map((char) => (
            <Key
              key={char}
              testID={`search-key-${char}`}
              label={char}
              size={keySize}
              hasTVPreferredFocus={hasTVPreferredFocus === true && char === 'A'}
              onPress={() => onChar(char)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Total width of the keyboard for a key size. */
export function keyboardWidth(keySize: number): number {
  return COLUMNS * (keySize + KEY_GAP * 2);
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  key: {
    margin: KEY_GAP,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.primary },
  focused: { borderColor: colors.focusBorder, backgroundColor: colors.text },
  label: { color: colors.text, fontSize: fontSize.body },
  focusedLabel: { color: colors.background },
});
