import { useState } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';

import type { Flag } from '../../core/types';
import { Button, Chip, color, radii, scaledText, useScaledStyles, type Scaler } from '../../ui';

export interface FlagPickerProps {
  flags: readonly Flag[];
  flagIndex: number;
  onSelect: (index: number) => void;
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
      <Button testID="detail-flag-picker" title={name} icon="chevronDown" size="md" onPress={() => setOpen(true)} />
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
