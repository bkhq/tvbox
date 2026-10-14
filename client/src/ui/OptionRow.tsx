import { Text, View } from 'react-native';

import { AnimatedPressable, FocusRing, type FocusableProps } from './Button';
import { Icon } from './Icon';
import { useScaledStyles, type Scaler } from './scale';
import { color, focus, radii } from './tokens';
import { fontFamily, scaledText } from './typography';
import { useFocusAnimation } from './useFocusAnimation';

export interface OptionRowProps extends Omit<FocusableProps, 'onLongPress'> {
  label: string;
  /** Right-aligned current value, e.g. of a setting. */
  value?: string;
  /** Caption under the label. */
  hint?: string;
  /** The current choice: accent label and check mark. */
  selected?: boolean;
  /** surface-2 fill, for rows listed on a surface panel. */
  raised?: boolean;
}

/** Full-width selectable row of settings lists, player panels and pickers; inverted with a ring when focused. */
export function OptionRow({
  label,
  value,
  hint,
  selected,
  raised,
  onPress,
  onFocus,
  onBlur,
  disabled,
  hasTVPreferredFocus,
  style,
  testID,
  ...nextFocus
}: OptionRowProps) {
  const { focused, animatedStyle, handlers } = useFocusAnimation({ onFocus, onBlur });
  const styles = useScaledStyles(makeStyles);
  return (
    <AnimatedPressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      {...handlers}
      style={[
        styles.row,
        raised && styles.raised,
        focused && styles.focused,
        disabled && styles.disabled,
        style,
        animatedStyle,
      ]}
      {...nextFocus}
    >
      {focused ? <FocusRing radius={styles.row.borderRadius} /> : null}
      <View style={styles.labelBox}>
        <Text numberOfLines={1} style={[styles.label, selected && styles.labelSelected, focused && styles.inverse]}>
          {label}
        </Text>
        {hint ? (
          <Text numberOfLines={2} style={[styles.hint, focused && styles.inverse]}>
            {hint}
          </Text>
        ) : null}
      </View>
      {value !== undefined ? (
        <Text numberOfLines={1} style={[styles.value, focused && styles.inverse]}>
          {value}
        </Text>
      ) : null}
      {selected ? <Icon name="check" size={28} color={focused ? color.inverseText : color.accent} /> : null}
    </AnimatedPressable>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: s(16),
      minHeight: s(76),
      paddingVertical: s(12),
      paddingHorizontal: s(28),
      borderRadius: s(radii.button),
      backgroundColor: color.surface,
    },
    raised: { backgroundColor: color.surface2 },
    focused: { backgroundColor: focus.borderColor },
    disabled: { opacity: 0.4 },
    labelBox: { flex: 1, gap: s(4) },
    label: { fontFamily: fontFamily.semiBold, fontSize: s(26), lineHeight: s(34), color: color.text },
    labelSelected: { fontFamily: fontFamily.bold, color: color.accent },
    hint: { ...text.caption, color: color.text3 },
    value: { ...text.label, flexShrink: 1, color: color.text2 },
    inverse: { color: color.inverseText },
  };
};
