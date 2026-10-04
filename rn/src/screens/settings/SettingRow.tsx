import { type ReactNode, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, fontSize, radius, spacing } from '../../ui';

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

export interface SettingRowProps {
  title: string;
  value?: string;
  /** Short note under the title, e.g. why a choice is unavailable. */
  note?: string;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  hasTVPreferredFocus?: boolean;
  testID?: string;
}

/** Focusable row with a title on the left and the current value on the right. */
export function SettingRow({ title, value, note, onPress, disabled, selected, hasTVPreferredFocus, testID }: SettingRowProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.row, focused && styles.rowFocused, disabled && styles.rowDisabled]}
    >
      <View style={styles.titleBox}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {note ? <Text style={styles.note}>{note}</Text> : null}
      </View>
      {selected ? <Text style={styles.badge}>当前</Text> : null}
      {value !== undefined ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    marginBottom: spacing.xs,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowFocused: {
    borderColor: colors.focusBorder,
    backgroundColor: colors.surfaceFocused,
  },
  rowDisabled: {
    opacity: 0.5,
  },
  titleBox: {
    flex: 1,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.title,
  },
  note: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  badge: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
    color: colors.text,
    fontSize: fontSize.caption,
  },
  value: {
    flexShrink: 1,
    marginLeft: spacing.md,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
});
