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

/** icon: round 14% white fill; outline: 52 px round top-bar button with a 2 px frame. */
export type ButtonVariant = 'primary' | 'secondary' | 'icon' | 'outline';
export type ButtonSize = 'md' | 'lg';

export interface ButtonProps extends FocusableProps {
  title?: string;
  icon?: IconName;
  /** Icon after the title, e.g. a chevron on a picker button. */
  trailingIcon?: IconName;
  variant?: ButtonVariant;
  /** md: 64 high (player OSD, dialogs); lg: 76 high (detail actions). */
  size?: ButtonSize;
  /** Spoken label; required in practice for the icon and outline variants. */
  accessibilityLabel?: string;
}

const height = { md: 68, lg: 80 } as const;
const OUTLINE_SIZE = 52;

export function Button({
  title,
  icon,
  trailingIcon,
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
  const outline = variant === 'outline';
  const round = variant === 'icon' || outline;
  const edge = s(outline ? OUTLINE_SIZE : height[size]);
  const large = size === 'lg';
  const primary = variant === 'primary';
  const fg = focused || primary ? color.inverseText : color.text;
  const iconSize = outline ? 24 : large ? 26 : 24;
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
        { height: edge },
        round ? { width: edge, borderRadius: edge / 2 } : { paddingHorizontal: s(large && primary ? 40 : 32) },
        primary ? styles.primary : outline ? styles.outline : styles.secondary,
        focused && styles.focused,
        focused && outline && styles.outlineFocused,
        disabled && styles.disabled,
        style,
        animatedStyle,
      ]}
      {...nextFocus}
    >
      {focused ? <FocusRing radius={round ? edge / 2 : s(radii.button)} /> : null}
      {icon ? <Icon name={icon} size={iconSize} color={fg} /> : null}
      {title && !round ? (
        <Text
          numberOfLines={1}
          style={[
            styles.title,
            primary ? styles.titlePrimary : null,
            { color: fg, fontSize: s(large && primary ? 32 : 30) },
          ]}
        >
          {title}
        </Text>
      ) : null}
      {trailingIcon && !round ? <Icon name={trailingIcon} size={iconSize} color={fg} /> : null}
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
  outline: { borderWidth: s(2), borderColor: color.border },
  focused: { backgroundColor: focus.borderColor },
  outlineFocused: { borderColor: focus.borderColor },
  disabled: { opacity: 0.4 },
  // Shrinks so a maxWidth truncates the title, not the icons.
  title: { flexShrink: 1, fontFamily: fontFamily.semiBold, lineHeight: s(36) },
  titlePrimary: { fontFamily: fontFamily.bold },
});
