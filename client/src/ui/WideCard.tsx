import { memo, useMemo } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { FocusableProps } from './Button';
import { imageSource } from './imageSource';
import { useScale, useScaledStyles, type Scaler } from './scale';
import { card, color, focus, radii } from './tokens';
import { scaledText } from './typography';
import { useFocusAnimation } from './useFocusAnimation';

export interface WideCardProps extends FocusableProps {
  /** Line under the still, e.g. the show or episode name. */
  title: string;
  /** Text inside the still over the bottom gradient, e.g. "第 5 集 · 剩余 18 分钟". */
  subtitle?: string;
  /** Still / poster url; may carry `@Referer=` style headers (see imageSource). */
  image?: string;
  /** Watched fraction 0..1; draws the accent bar along the bottom edge. */
  progress?: number;
  /** Width in design px; the still keeps 16:9. */
  width?: number;
}

const progressTrack = 'rgba(255,255,255,0.25)';

function clamp01(value: number): number {
  return value > 0 ? Math.min(value, 1) : 0;
}

function WideCardImpl({
  title,
  subtitle,
  image,
  progress,
  width = card.wide.width,
  onPress,
  onLongPress,
  onFocus,
  onBlur,
  disabled,
  hasTVPreferredFocus,
  style,
  testID,
  ...nextFocus
}: WideCardProps) {
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus, onBlur });
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const box = { width: s(width), height: s((width * 9) / 16) };
  const source = useMemo(() => imageSource(image), [image]);
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
      <Animated.View style={[box, focused && styles.lifted, animatedStyle]}>
        <View style={styles.still}>
          {source ? <Image source={source} style={StyleSheet.absoluteFill} resizeMode="cover" resizeMethod="resize" /> : null}
          {subtitle ? (
            <>
              <View pointerEvents="none" style={styles.gradient}>
                <Svg width="100%" height="100%">
                  <Defs>
                    <LinearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
                      <Stop offset="0" stopColor={color.bg} stopOpacity={0} />
                      <Stop offset="1" stopColor={color.bg} stopOpacity={0.85} />
                    </LinearGradient>
                  </Defs>
                  <Rect width="100%" height="100%" fill="url(#shade)" />
                </Svg>
              </View>
              <Text numberOfLines={1} style={styles.subtitle}>
                {subtitle}
              </Text>
            </>
          ) : null}
          {progress !== undefined ? (
            <View testID={testID && `${testID}-progress`} style={styles.track}>
              <View style={[styles.fill, { width: `${clamp01(progress) * 100}%` }]} />
            </View>
          ) : null}
        </View>
        {focused ? <View pointerEvents="none" style={styles.focusBorder} /> : null}
      </Animated.View>
      <Text numberOfLines={1} style={[styles.title, focused && styles.titleFocused]}>
        {title}
      </Text>
    </Pressable>
  );
}

export const WideCard = memo(WideCardImpl);

const makeStyles = (s: Scaler) => {
  const { body, caption } = scaledText(s);
  return {
    card: { gap: s(12) },
    // The focused card rises off the page (tvOS focus): a soft drop shadow under the zoom.
    lifted: { borderRadius: s(radii.card), boxShadow: `0px ${s(18)}px ${s(36)}px ${color.shadow}` },
    still: { flex: 1, borderRadius: s(radii.card), overflow: 'hidden' as const, backgroundColor: color.surface },
    gradient: { position: 'absolute' as const, left: 0, right: 0, bottom: 0, height: '50%' as const },
    subtitle: {
      ...caption,
      position: 'absolute' as const,
      left: s(14),
      right: s(14),
      bottom: s(18),
      color: color.text,
    },
    track: {
      position: 'absolute' as const,
      left: 0,
      right: 0,
      bottom: 0,
      height: s(6),
      backgroundColor: progressTrack,
    },
    fill: { height: '100%' as const, backgroundColor: color.accent },
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
    title: { ...body, color: color.text2, paddingTop: s(6) },
    titleFocused: { color: color.text },
  };
};
