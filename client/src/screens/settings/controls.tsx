import type { Ref } from 'react';
import { Pressable, Text, View } from 'react-native';

import { color, FocusRing, fontFamily, useFocusAnimation, useScaledStyles, type Scaler } from '../../ui';
import type { Option } from './options';

/** On/off switch drawn at the right of a toggle row; the row itself takes focus and toggles on OK. */
export function Toggle({ value, testID }: { value: boolean; testID?: string }) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View testID={testID} style={[styles.track, value ? styles.trackOn : styles.trackOff]}>
      <View style={[styles.knob, value ? styles.knobOn : styles.knobOff]} />
    </View>
  );
}

function Segment({
  label,
  selected,
  hasTVPreferredFocus,
  onPress,
  testID,
  ref,
}: {
  label: string;
  selected: boolean;
  hasTVPreferredFocus?: boolean;
  onPress: () => void;
  testID?: string;
  ref?: Ref<View>;
}) {
  const styles = useScaledStyles(makeStyles);
  const { focused, handlers } = useFocusAnimation();
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      {...handlers}
      style={[styles.segment, selected && styles.segmentSelected]}
    >
      {focused ? <FocusRing radius={styles.segment.borderRadius} /> : null}
      <Text numberOfLines={1} style={[styles.segmentLabel, selected && styles.segmentLabelSelected]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Inline single choice; D-pad left/right moves between segments and OK selects one. */
export function Segmented<T>({
  options,
  value,
  onChange,
  hasTVPreferredFocus,
  testIDPrefix,
  preferredRef,
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Focus goes to the selected segment, or the first one when none is selected. */
  hasTVPreferredFocus?: boolean;
  testIDPrefix?: string;
  /** Ref of the segment hasTVPreferredFocus would focus. */
  preferredRef?: Ref<View>;
}) {
  const styles = useScaledStyles(makeStyles);
  const preferred = options.find((option) => option.value === value) ?? options[0];
  return (
    <View style={styles.segmented}>
      {options.map((option) => (
        <Segment
          key={String(option.value)}
          testID={testIDPrefix ? `${testIDPrefix}-${String(option.value)}` : undefined}
          label={option.label}
          selected={option.value === value}
          hasTVPreferredFocus={hasTVPreferredFocus && option === preferred}
          ref={option === preferred ? preferredRef : undefined}
          onPress={() => onChange(option.value)}
        />
      ))}
    </View>
  );
}

const makeStyles = (s: Scaler) => ({
  track: { width: s(88), height: s(48), borderRadius: s(24) },
  trackOn: { backgroundColor: color.accent },
  trackOff: { backgroundColor: color.border },
  knob: { position: 'absolute' as const, top: s(4), width: s(40), height: s(40), borderRadius: s(20) },
  knobOn: { left: s(44), backgroundColor: color.inverseText },
  knobOff: { left: s(4), backgroundColor: color.text },
  segmented: {
    flexDirection: 'row' as const,
    gap: s(6),
    padding: s(6),
    borderRadius: s(12),
    backgroundColor: color.bg,
  },
  segment: {
    height: s(52),
    paddingHorizontal: s(22),
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderRadius: s(8),
  },
  segmentSelected: { backgroundColor: color.text },
  segmentLabel: { fontFamily: fontFamily.semiBold, fontSize: s(29), lineHeight: s(36), color: color.text2 },
  segmentLabelSelected: { fontFamily: fontFamily.bold, color: color.inverseText },
});
