import { useState } from 'react';
import { Pressable, StyleSheet, Text, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';

import { colors, focusScale, fontSize, radius, spacing } from './theme';

type NextFocusProps = Pick<ViewProps, 'nextFocusUp' | 'nextFocusDown' | 'nextFocusLeft' | 'nextFocusRight'>;

export interface FocusableButtonProps extends NextFocusProps {
  title: string;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** Highlighted background, e.g. the selected tab or the primary action. */
  selected?: boolean;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function FocusableButton({
  title,
  onPress,
  onLongPress,
  disabled,
  selected,
  hasTVPreferredFocus,
  style,
  testID,
  ...nextFocus
}: FocusableButtonProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.button, selected && styles.selected, focused && styles.focused, disabled && styles.disabled, style]}
      {...nextFocus}
    >
      <Text style={styles.label} numberOfLines={1}>
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    margin: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
  },
  selected: {
    backgroundColor: colors.primary,
  },
  focused: {
    borderColor: colors.focusBorder,
    transform: [{ scale: focusScale }],
  },
  disabled: {
    opacity: 0.4,
  },
  label: {
    color: colors.text,
    fontSize: fontSize.body,
  },
});
