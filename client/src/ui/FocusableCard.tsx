import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ViewProps } from 'react-native';

import { colors, focusScale, fontSize, radius, spacing } from './theme';

type NextFocusProps = Pick<ViewProps, 'nextFocusUp' | 'nextFocusDown' | 'nextFocusLeft' | 'nextFocusRight'>;

export interface FocusableCardProps extends NextFocusProps {
  title: string;
  subtitle?: string;
  /** Badge shown on the poster, e.g. episode count or score. */
  remark?: string;
  poster?: string;
  /** Card width; the poster keeps a 3:4 aspect ratio. */
  width?: number;
  onPress?: () => void;
  onLongPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
}

export function FocusableCard({
  title,
  subtitle,
  remark,
  poster,
  width = 120,
  onPress,
  onLongPress,
  onFocus,
  onBlur,
  hasTVPreferredFocus,
  testID,
  ...nextFocus
}: FocusableCardProps) {
  const [focused, setFocused] = useState(false);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={() => {
        setFocused(true);
        onFocus?.();
      }}
      onBlur={() => {
        setFocused(false);
        onBlur?.();
      }}
      style={[styles.card, { width }, focused && styles.focused]}
      {...nextFocus}
    >
      <View style={styles.posterBox}>
        {poster ? <Image source={{ uri: poster }} style={styles.poster} resizeMode="cover" /> : null}
        {remark ? (
          <Text style={styles.remark} numberOfLines={1}>
            {remark}
          </Text>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: spacing.xs,
    padding: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  focused: {
    borderColor: colors.focusBorder,
    backgroundColor: colors.surfaceFocused,
    transform: [{ scale: focusScale }],
  },
  posterBox: {
    aspectRatio: 3 / 4,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  poster: {
    ...StyleSheet.absoluteFill,
  },
  remark: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    left: 0,
    paddingHorizontal: spacing.xs,
    color: colors.text,
    fontSize: fontSize.caption,
    textAlign: 'right',
    backgroundColor: colors.remarkBackground,
  },
  title: {
    marginTop: spacing.xs,
    color: colors.text,
    fontSize: fontSize.body,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
});
