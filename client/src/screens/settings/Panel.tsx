import type { ReactNode } from 'react';
import { Modal, ScrollView, Text, View } from 'react-native';

import { Button, color, scaledText, useLayout, useScaledStyles, type Scaler } from '../../ui';

/** Dimmed backdrop behind an editor card. */
const scrim = 'rgba(0,0,0,0.72)';

/**
 * In-screen editor overlay. The hardware back key (Android) and the Menu
 * button (tvOS) call onRequestClose, so back closes the panel before the
 * screen is popped.
 */
export function Panel({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { isTV } = useLayout();
  const styles = useScaledStyles(makeStyles);
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID="settings-panel" style={[styles.panel, isTV ? styles.panelTV : styles.panelPhone]}>
          <Text style={styles.title}>{title}</Text>
          <ScrollView contentContainerStyle={styles.content}>{children}</ScrollView>
          <Button testID="settings-panel-close" title="关闭" size="md" style={styles.close} onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (s: Scaler) => ({
  backdrop: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: scrim },
  panel: { maxHeight: '90%' as const, padding: s(40), gap: s(24), borderRadius: s(16), backgroundColor: color.surface },
  panelTV: { width: '50%' as const },
  panelPhone: { width: '92%' as const },
  title: { ...scaledText(s).h2, color: color.text },
  // Room for the focus border and ring of the rows and buttons inside.
  content: { gap: s(12), padding: s(8) },
  close: { alignSelf: 'flex-start' as const },
});
