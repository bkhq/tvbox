import { Text } from 'react-native';

import { AnimatedPressable, FocusRing, type FocusableProps } from './Button';
import { useScaledStyles, type Scaler } from './scale';
import { color, focus } from './tokens';
import { fontFamily } from './typography';
import { useFocusAnimation } from './useFocusAnimation';

export interface ChipProps extends FocusableProps {
  label: string;
  /** The active filter: light fill (accent fill for the accent variant), dark bold text. */
  selected?: boolean;
  /** accent: a selected chip takes the accent fill, so the current choice never reads as the focused one. */
  variant?: 'default' | 'accent';
}

/** Pill filter chip, as in the search page kind filters. */
export function Chip({
  label,
  selected,
  variant = 'default',
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
        selected && (variant === 'accent' ? styles.selectedAccent : styles.selected),
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
    height: s(60),
    paddingHorizontal: s(28),
    borderRadius: s(60) / 2,
    justifyContent: 'center' as const,
    backgroundColor: color.surface2,
  },
  selected: { backgroundColor: color.text },
  selectedAccent: { backgroundColor: color.accent },
  focused: { backgroundColor: focus.borderColor },
  disabled: { opacity: 0.4 },
  label: { fontFamily: fontFamily.semiBold, fontSize: s(30), lineHeight: s(38), color: color.text },
  labelInverse: { fontFamily: fontFamily.bold, color: color.inverseText },
});
