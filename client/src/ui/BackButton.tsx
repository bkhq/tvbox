import { Text } from 'react-native';

import { AnimatedPressable, FocusRing, type FocusableProps } from './Button';
import { Icon } from './Icon';
import { useScaledStyles, type Scaler } from './scale';
import { color, focus } from './tokens';
import { scaledText } from './typography';
import { useFocusAnimation } from './useFocusAnimation';

export interface BackButtonProps extends FocusableProps {
  onPress: () => void;
  label?: string;
}

/** The "返回" pill in the top-left corner of the detail and search pages. */
export function BackButton({
  onPress,
  label = '返回',
  onLongPress,
  onFocus,
  onBlur,
  disabled,
  hasTVPreferredFocus,
  style,
  testID,
  ...nextFocus
}: BackButtonProps) {
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus, onBlur });
  const styles = useScaledStyles(makeStyles);
  const fg = focused ? color.inverseText : color.text;
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      {...handlers}
      style={[styles.pill, focused && styles.focused, disabled && styles.disabled, style, animatedStyle]}
      {...nextFocus}
    >
      {focused ? <FocusRing radius={styles.pill.borderRadius} /> : null}
      <Icon name="back" size={26} color={fg} />
      <Text numberOfLines={1} style={[styles.label, { color: fg }]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const makeStyles = (s: Scaler) => ({
  pill: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    alignSelf: 'flex-start' as const,
    gap: s(12),
    height: s(52),
    paddingLeft: s(14),
    paddingRight: s(20),
    borderRadius: s(26),
    backgroundColor: color.buttonFill,
  },
  focused: { backgroundColor: focus.borderColor },
  disabled: { opacity: 0.4 },
  label: scaledText(s).label,
});
