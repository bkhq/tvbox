import { Text } from 'react-native';

import { AnimatedPressable, FocusRing, type FocusableProps } from './Button';
import { useScaledStyles, type Scaler } from './scale';
import { color, focus } from './tokens';
import { fontFamily } from './typography';
import { useFocusAnimation } from './useFocusAnimation';

export interface ChipProps extends FocusableProps {
  label: string;
  /** The active filter: light fill, dark bold text. */
  selected?: boolean;
}

/** Pill filter chip, as in the search page kind filters. */
export function Chip({
  label,
  selected,
  onPress,
  onLongPress,
  onFocus,
  onBlur,
  disabled,
  hasTVPreferredFocus,
  style,
  testID,
  ...nextFocus
}: ChipProps) {
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus, onBlur });
  const styles = useScaledStyles(makeStyles);
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      {...handlers}
      style={[
        styles.chip,
        selected && styles.selected,
        focused && styles.focused,
        disabled && styles.disabled,
        style,
        animatedStyle,
      ]}
      {...nextFocus}
    >
      {focused ? <FocusRing radius={styles.chip.borderRadius} /> : null}
      <Text numberOfLines={1} style={[styles.label, (selected || focused) && styles.labelInverse]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const makeStyles = (s: Scaler) => ({
  chip: {
    height: s(48),
    paddingHorizontal: s(20),
    borderRadius: s(24),
    justifyContent: 'center' as const,
    backgroundColor: color.surface2,
  },
  selected: { backgroundColor: color.text },
  focused: { backgroundColor: focus.borderColor },
  disabled: { opacity: 0.4 },
  label: { fontFamily: fontFamily.semiBold, fontSize: s(20), lineHeight: s(28), color: color.text },
  labelInverse: { fontFamily: fontFamily.bold, color: color.inverseText },
});
