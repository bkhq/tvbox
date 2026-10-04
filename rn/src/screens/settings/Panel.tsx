import type { ReactNode } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import { colors, FocusableButton, fontSize, radius, spacing, useLayout } from '../../ui';

/**
 * In-screen editor overlay. The hardware back key (Android) and the Menu
 * button (tvOS) call onRequestClose, so back closes the panel before the
 * screen is popped.
 */
export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { isTV } = useLayout();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID="settings-panel" style={[styles.panel, isTV ? styles.panelTV : styles.panelPhone]}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
          <FocusableButton testID="settings-panel-close" title="关闭" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.remarkBackground,
  },
  panel: {
    maxHeight: '90%',
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  panelTV: {
    width: '50%',
  },
  panelPhone: {
    width: '92%',
  },
  title: {
    marginBottom: spacing.md,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  content: {
    paddingBottom: spacing.md,
  },
});
