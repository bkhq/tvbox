import { memo, useMemo } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from './Badge';
import type { FocusableProps } from './Button';
import { imageSource } from './imageSource';
import { useScale, useScaledStyles, type Scaler } from './scale';
import { card, color, focus, radii } from './tokens';
import { scaledText } from './typography';
import { useFocusAnimation } from './useFocusAnimation';

export interface PosterCardProps extends FocusableProps {
  title: string;
  /** Second line under the title, e.g. "2024 · 8.6" or the source remarks. */
  meta?: string;
  /** Picture url; may carry `@Referer=` style headers (see imageSource). */
  poster?: string;
  /** Corner tag on the poster, e.g. "更新至12集". */
  badge?: string;
  badgeVariant?: 'accent' | 'outline';
  /** Width in design px; the poster keeps 2:3. */
  width?: number;
}

function PosterCardImpl({
  title,
  meta,
  poster,
  badge,
  badgeVariant = 'accent',
  width = card.poster.width,
  onPress,
  onLongPress,
  onFocus,
  onBlur,
  disabled,
  hasTVPreferredFocus,
  style,
  testID,
  ...nextFocus
}: PosterCardProps) {
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus, onBlur });
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const box = { width: s(width), height: s((width * 3) / 2) };
  const source = useMemo(() => imageSource(poster), [poster]);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      {...handlers}
      style={[styles.card, { width: box.width }, style]}
      {...nextFocus}
    >
      <Animated.View style={[box, animatedStyle]}>
        <View style={styles.poster}>
          {source ? <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" /> : null}
          {badge ? <Badge label={badge} variant={badgeVariant} style={styles.badge} /> : null}
        </View>
        {focused ? <View pointerEvents="none" style={styles.focusBorder} /> : null}
      </Animated.View>
      <Text numberOfLines={1} style={[styles.title, focused && styles.titleFocused]}>
        {title}
      </Text>
      {meta ? (
        <Text numberOfLines={1} style={styles.meta}>
          {meta}
        </Text>
      ) : null}
    </Pressable>
  );
}

export const PosterCard = memo(PosterCardImpl);

const makeStyles = (s: Scaler) => {
  const { label, caption } = scaledText(s);
  return {
    card: { gap: s(12) },
    poster: { flex: 1, borderRadius: s(radii.card), overflow: 'hidden' as const, backgroundColor: color.surface },
    badge: { position: 'absolute' as const, top: s(12), left: s(12), backgroundColor: 'rgba(11,14,20,0.7)' },
    focusBorder: {
      position: 'absolute' as const,
      top: -s(focus.borderWidth),
      right: -s(focus.borderWidth),
      bottom: -s(focus.borderWidth),
      left: -s(focus.borderWidth),
      borderWidth: s(focus.borderWidth),
      borderColor: focus.borderColor,
      borderRadius: s(radii.card + focus.borderWidth),
    },
    title: { ...label, color: color.text2 },
    titleFocused: { color: color.text },
    meta: { ...caption, color: color.text3, marginTop: -s(6) },
  };
};
