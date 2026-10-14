import { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';

import type { Flag } from '../../core/types';
import {
  AnimatedPressable,
  Chip,
  color,
  focus,
  FocusRing,
  fontFamily,
  Icon,
  radii,
  scaledText,
  useFocusAnimation,
  useScale,
  useScaledStyles,
  type Scaler,
} from '../../ui';

export interface FlagPickerProps {
  flags: readonly Flag[];
  flagIndex: number;
  onSelect: (index: number) => void;
}

/** Secondary md button look with a trailing chevron (ui Button only has a leading icon). */
function FlagButton({ name, onPress }: { name: string; onPress: () => void }) {
  const { s } = useScale();
  const styles = useScaledStyles(makeStyles);
  const { focused, animatedStyle, handlers } = useFocusAnimation();
  const fg = focused ? color.inverseText : color.text;
  return (
    <AnimatedPressable
      testID="detail-flag-picker"
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onPress}
      {...handlers}
      style={[styles.button, focused && styles.buttonFocused, animatedStyle]}
    >
      {focused ? <FocusRing radius={s(radii.button)} /> : null}
      <Text testID="detail-flag-picker-name" numberOfLines={1} style={[styles.buttonTitle, { color: fg }]}>
        {name}
      </Text>
      <Icon testID="detail-flag-picker-chevron" name="chevronDown" size={24} color={fg} />
    </AnimatedPressable>
  );
}

/** Current play line; with several lines a button opening the list of all of them. */
export function FlagPicker({ flags, flagIndex, onSelect }: FlagPickerProps) {
  const styles = useScaledStyles(makeStyles);
  const [open, setOpen] = useState(false);
  const name = flags[flagIndex]?.flag ?? '';
  if (flags.length <= 1) {
    return (
      <Text testID="detail-flag-name" numberOfLines={1} style={styles.name}>
        {name}
      </Text>
    );
  }
  return (
    <>
      <FlagButton name={name} onPress={() => setOpen(true)} />
      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <View style={styles.scrim}>
          <View style={styles.panel} testID="detail-flag-list">
            <Text style={styles.title}>选择线路</Text>
            <ScrollView contentContainerStyle={styles.list}>
              {flags.map((flag, index) => (
                <Chip
                  key={`${index}-${flag.flag}`}
                  testID={`detail-flag-${index}`}
                  label={flag.flag}
                  selected={index === flagIndex}
                  hasTVPreferredFocus={index === flagIndex}
                  onPress={() => {
                    setOpen(false);
                    onSelect(index);
                  }}
                />
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    name: { ...text.label, color: color.text2 },
    button: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: s(12),
      height: s(64),
      paddingHorizontal: s(32),
      borderRadius: s(radii.button),
      backgroundColor: color.buttonFill,
    },
    buttonFocused: { backgroundColor: focus.borderColor },
    buttonTitle: { fontFamily: fontFamily.semiBold, fontSize: s(26), lineHeight: s(36) },
    scrim: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: 'rgba(11,14,20,0.8)',
    },
    panel: {
      width: s(960),
      maxHeight: s(720),
      padding: s(40),
      gap: s(24),
      borderRadius: s(radii.button),
      backgroundColor: color.surface2,
    },
    title: { ...text.h2, color: color.text },
    list: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: s(16), padding: s(8) },
  };
};
