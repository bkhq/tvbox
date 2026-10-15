import { Text, View } from 'react-native';

import { AnimatedPressable, type FocusableProps } from './Button';
import { useScaledStyles, type Scaler } from './scale';
import { color, focus, radii, type } from './tokens';
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
      style={[styles.tab, focused && styles.focused, disabled && styles.disabled, style, animatedStyle]}
      {...nextFocus}
    >
      <Text numberOfLines={1} style={[styles.label, active && styles.labelActive, focused && styles.labelFocused]}>
        {label}
      </Text>
      {active ? <View testID={testID ? `${testID}-underline` : undefined} style={styles.underline} /> : null}
    </AnimatedPressable>
  );
}

/** Mockup tab: 10/4 padding over a 4 underline. */
const MOCK_PAD_X = 4;
const UNDERLINE = 4;
/** Room around the label for the focus fill. */
const PAD_X = 20;

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    // The negative margin keeps the mockup's 4 padding in layout, so labels do not move against the gaps.
    tab: {
      paddingTop: s(10),
      paddingBottom: s(10 + UNDERLINE),
      paddingHorizontal: s(PAD_X),
      marginHorizontal: -s(PAD_X - MOCK_PAD_X),
      borderRadius: s(radii.button),
    },
    // As in the mockup the underline spans the label plus 4 per side, not the focus padding.
    underline: {
      position: 'absolute' as const,
      left: s(PAD_X - MOCK_PAD_X),
      right: s(PAD_X - MOCK_PAD_X),
      bottom: 0,
      height: s(UNDERLINE),
      backgroundColor: color.accent,
    },
    // Like the top-bar buttons: focus inverts to a white fill with dark text.
    focused: { backgroundColor: focus.borderColor },
    disabled: { opacity: 0.4 },
    // Title 3: the bar is the largest navigation text on screen.
    label: { ...text.body, fontSize: s(type.h1.fontSize), lineHeight: s(type.h1.lineHeight), color: color.text2 },
    labelActive: { fontFamily: fontFamily.bold, color: color.text },
    labelFocused: { color: color.inverseText },
  };
};
