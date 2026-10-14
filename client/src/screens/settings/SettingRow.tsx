import { type ReactNode, type Ref, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Badge, color, fontFamily, Icon, radii, scaledText, useScaledStyles, type Scaler } from '../../ui';
import { Segmented, Toggle } from './controls';
import type { Option } from './options';

export interface SettingRowProps {
  title: string;
  value?: string;
  /** Description under the title, e.g. why a choice is unavailable. */
  note?: string;
  onPress?: () => void;
  disabled?: boolean;
  selected?: boolean;
  /** Chevron after the value: the row opens a picker. */
  chevron?: boolean;
  /** Control at the right end (toggle, segmented, button). */
  accessory?: ReactNode;
  hasTVPreferredFocus?: boolean;
  /** surface-2 fill, for rows listed on a surface panel. */
  raised?: boolean;
  testID?: string;
  noteTestID?: string;
  ref?: Ref<View>;
}

/**
 * Row card with the title (and description) on the left and the value or a control on the right.
 * Without onPress the card is not focusable, so a control inside it takes the focus instead.
 */
export function SettingRow({
  title,
  value,
  note,
  onPress,
  disabled,
  selected,
  chevron,
  accessory,
  hasTVPreferredFocus,
  raised,
  testID,
  noteTestID,
  ref,
}: SettingRowProps) {
  const styles = useScaledStyles(makeStyles);
  const [focused, setFocused] = useState(false);
  const content = (
    <>
      <View style={styles.titleBox}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        {note ? (
          <Text testID={noteTestID} style={styles.note}>
            {note}
          </Text>
        ) : null}
      </View>
      {selected ? <Badge label="当前" variant="accent" style={styles.badge} /> : null}
      {value !== undefined ? (
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {chevron ? <Icon name="chevronRight" size={28} color={color.text3} /> : null}
      {accessory}
    </>
  );
  if (!onPress) {
    return (
      <View ref={ref} collapsable={false} testID={testID} style={[styles.row, disabled && styles.rowDisabled]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      ref={ref}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[styles.row, raised && styles.rowRaised, focused && styles.rowFocused, disabled && styles.rowDisabled]}
    >
      {content}
    </Pressable>
  );
}

/** Row whose right side is a switch; OK anywhere on the row flips it. */
export function ToggleSettingRow({
  value,
  testID,
  ...row
}: Omit<SettingRowProps, 'value' | 'accessory' | 'chevron' | 'selected'> & { value: boolean }) {
  return (
    <SettingRow
      {...row}
      testID={testID}
      accessory={<Toggle value={value} testID={testID ? `${testID}-toggle` : undefined} />}
    />
  );
}

/** Row with an inline segmented choice; the segments take the focus, not the row. */
export function SegmentedSettingRow<T>({
  title,
  note,
  options,
  value,
  onChange,
  hasTVPreferredFocus,
  testID,
  ref,
}: {
  title: string;
  note?: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  hasTVPreferredFocus?: boolean;
  testID?: string;
  /** Ref of the segment that takes the focus first (see Segmented). */
  ref?: Ref<View>;
}) {
  return (
    <SettingRow
      title={title}
      note={note}
      testID={testID}
      accessory={
        <Segmented
          options={options}
          value={value}
          onChange={onChange}
          hasTVPreferredFocus={hasTVPreferredFocus}
          testIDPrefix={testID}
          preferredRef={ref}
        />
      }
    />
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: s(16),
      minHeight: s(96),
      paddingVertical: s(16),
      paddingHorizontal: s(28),
      borderRadius: s(radii.button),
      borderWidth: s(4),
      borderColor: 'transparent',
      backgroundColor: color.surface,
    },
    rowRaised: { backgroundColor: color.surface2 },
    rowFocused: {
      borderColor: color.focusBorder,
      backgroundColor: color.surface2,
      shadowColor: color.shadow,
      shadowOpacity: 1,
      shadowRadius: s(24),
      shadowOffset: { width: 0, height: s(12) },
      elevation: 12,
    },
    rowDisabled: { opacity: 0.45 },
    badge: { alignSelf: 'center' as const },
    titleBox: { flex: 1, gap: s(6) },
    title: { fontFamily: fontFamily.semiBold, fontSize: s(26), lineHeight: s(34), color: color.text },
    note: { ...text.caption, color: color.text3 },
    value: { ...text.label, flexShrink: 1, color: color.text2 },
  };
};
