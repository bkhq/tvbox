import { useEffect, useMemo, useState } from 'react';
import { Animated, type PressableProps } from 'react-native';

import { focus } from './tokens';

type FocusEvent = Parameters<NonNullable<PressableProps['onFocus']>>[0];
type BlurEvent = Parameters<NonNullable<PressableProps['onBlur']>>[0];
type PressEvent = Parameters<NonNullable<PressableProps['onPressIn']>>[0];

export interface FocusAnimationCallbacks {
  onFocus?: (event: FocusEvent) => void;
  onBlur?: (event: BlurEvent) => void;
  onPressIn?: (event: PressEvent) => void;
  onPressOut?: (event: PressEvent) => void;
}

export interface FocusAnimation {
  focused: boolean;
  pressed: boolean;
  animatedStyle: { transform: { scale: Animated.Value }[] };
  /** Spread onto the Pressable; chains the callbacks passed to the hook. */
  handlers: Required<FocusAnimationCallbacks>;
}

/** Near-critically damped spring that settles in about focus.springMs (180 ms). */
export const focusSpring = { stiffness: 1000, damping: 60, mass: 1 } as const;

export function useFocusAnimation({
  onFocus,
  onBlur,
  onPressIn,
  onPressOut,
}: FocusAnimationCallbacks = {}): FocusAnimation {
  const [focused, setFocused] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [scale] = useState(() => new Animated.Value(1));
  const target = pressed ? focus.pressedScale : focused ? focus.scale : 1;

  useEffect(() => {
    const animation = Animated.spring(scale, { toValue: target, useNativeDriver: true, ...focusSpring });
    animation.start();
    return () => animation.stop();
  }, [scale, target]);

  const animatedStyle = useMemo(() => ({ transform: [{ scale }] }), [scale]);

  const handlers = useMemo(
    () => ({
      onFocus: (event: FocusEvent) => {
        setFocused(true);
        onFocus?.(event);
      },
      onBlur: (event: BlurEvent) => {
        setFocused(false);
        setPressed(false);
        onBlur?.(event);
      },
      onPressIn: (event: PressEvent) => {
        setPressed(true);
        onPressIn?.(event);
      },
      onPressOut: (event: PressEvent) => {
        setPressed(false);
        onPressOut?.(event);
      },
    }),
    [onFocus, onBlur, onPressIn, onPressOut],
  );

  return { focused, pressed, animatedStyle, handlers };
}
