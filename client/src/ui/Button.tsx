import {
  Animated,
  Pressable,
  Text,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from 'react-native';

import { Icon, type IconName } from './Icon';
import { useScale, useScaledStyles, type Scaler } from './scale';
import { color, focus, radii } from './tokens';
import { fontFamily } from './typography';
import { useFocusAnimation, type FocusAnimationCallbacks } from './useFocusAnimation';

type NextFocusProps = Pick<ViewProps, 'nextFocusUp' | 'nextFocusDown' | 'nextFocusLeft' | 'nextFocusRight'>;

/** Props shared by the focusable controls of the UI kit. */
export interface FocusableProps extends NextFocusProps {
  onPress?: () => void;
  onLongPress?: () => void;
  onFocus?: FocusAnimationCallbacks['onFocus'];
  onBlur?: FocusAnimationCallbacks['onBlur'];
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** White outer ring of a focused button, separated from it by a ringGap-wide gap. */
export function FocusRing({ radius }: { radius: number }) {
  const { s } = useScale();
  const inset = -s(focus.ringGap + focus.ringWidth);
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: inset,
        right: inset,
        bottom: inset,
        left: inset,
        borderWidth: s(focus.ringWidth),
        borderColor: focus.borderColor,
        borderRadius: radius - inset,
      }}
    />
  );
}

export type ButtonVariant = 'primary' | 'secondary' | 'icon';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends FocusableProps {
  title?: string;
  icon?: IconName;
  variant?: ButtonVariant;
  /** md: 64 high (player OSD, dialogs); lg: 76 high (detail actions). */
  size?: ButtonSize;
  /** Spoken label; required in practice for the icon variant. */
  accessibilityLabel?: string;
}

const height = { md: 64, lg: 76 } as const;

export function Button({
  title,
  icon,
  variant = 'secondary',
  size = 'lg',
  accessibilityLabel,
  onPress,
  onLongPress,
  onFocus,
  onBlur,
  disabled,
  hasTVPreferredFocus,
  style,
  testID,
  ...nextFocus
}: ButtonProps) {
  const { s } = useScale();
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus, onBlur });
  const styles = useScaledStyles(makeStyles);
  const round = variant === 'icon';
  const large = size === 'lg';
  const primary = variant === 'primary';
  const fg = focused || primary ? color.inverseText : color.text;
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      {...handlers}
      style={[
        styles.button,
        { height: s(height[size]) },
        round
          ? { width: s(height[size]), borderRadius: s(height[size]) / 2 }
          : { paddingHorizontal: s(large && primary ? 40 : 32) },
        primary ? styles.primary : styles.secondary,
        focused && styles.focused,
        disabled && styles.disabled,
        style,
        animatedStyle,
      ]}
      {...nextFocus}
    >
      {focused ? <FocusRing radius={round ? s(height[size]) / 2 : s(radii.button)} /> : null}
      {icon ? <Icon name={icon} size={large ? 26 : 24} color={fg} /> : null}
      {title && !round ? (
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            primary ? styles.titlePrimary : null,
            { color: fg, fontSize: s(large && primary ? 28 : 26) },
          ]}
        >
          {title}
        </Text>
      ) : null}
    </AnimatedPressable>
  );
}

const makeStyles = (s: Scaler) => ({
  button: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: s(12),
    borderRadius: s(radii.button),
  },
  primary: { backgroundColor: color.accent },
  secondary: { backgroundColor: color.buttonFill },
  focused: { backgroundColor: focus.borderColor },
  disabled: { opacity: 0.4 },
  title: { fontFamily: fontFamily.semiBold, lineHeight: s(36) },
  titlePrimary: { fontFamily: fontFamily.bold },
});
