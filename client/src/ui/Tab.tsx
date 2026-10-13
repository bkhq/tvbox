import { Text } from 'react-native';

import { AnimatedPressable, type FocusableProps } from './Button';
import { useScaledStyles, type Scaler } from './scale';
import { color, focus, radii } from './tokens';
import { fontFamily, scaledText } from './typography';
import { useFocusAnimation } from './useFocusAnimation';

export interface TabProps extends FocusableProps {
  label: string;
  /** The current tab: bold text over an accent underline. */
  active?: boolean;
}

/** Text tab of the top navigation and detail sections. */
export function Tab({
  label,
  active,
  onPress,
  onLongPress,
  onFocus,
  onBlur,
  disabled,
  hasTVPreferredFocus,
  style,
  testID,
  ...nextFocus
}: TabProps) {
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus, onBlur });
  const styles = useScaledStyles(makeStyles);
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onLongPress={onLongPress}
      {...handlers}
      style={[
        styles.tab,
        active && styles.active,
        focused && styles.focused,
        disabled && styles.disabled,
        style,
        animatedStyle,
      ]}
      {...nextFocus}
    >
      <Text numberOfLines={1} style={[styles.label, active && styles.labelActive, focused && styles.labelFocused]}>
        {label}
      </Text>
    </AnimatedPressable>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    tab: {
      paddingVertical: s(10),
      paddingHorizontal: s(4),
      borderBottomWidth: s(4),
      borderBottomColor: 'transparent',
      borderRadius: s(radii.tag),
    },
    active: { borderBottomColor: color.accent },
    // Like the top-bar buttons: focus inverts to a white fill with dark text.
    focused: { backgroundColor: focus.borderColor },
    disabled: { opacity: 0.4 },
    label: { ...text.body, color: color.text2 },
    labelActive: { fontFamily: fontFamily.bold, color: color.text },
    labelFocused: { color: color.inverseText },
  };
};
