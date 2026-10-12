import { type ReactNode, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { useSetting } from '../../core/settings/useSetting';
import type { Live } from '../../core/types';
import { colors, FocusableButton, fontSize, radius, spacing, useLayout } from '../../ui';

function Sheet({ title, testID, onClose, children }: { title: string; testID: string; onClose(): void; children: ReactNode }) {
  const { isTV } = useLayout();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID={testID} style={[styles.panel, isTV ? styles.panelTV : styles.panelPhone]}>
          <Text style={styles.title}>{title}</Text>
          {children}
          <FocusableButton testID="live-panel-close" title="关闭" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function Toggle({ setting, title }: { setting: 'invert' | 'across' | 'change'; title: string }) {
  const [value, setValue] = useSetting(setting);
  return (
    <FocusableButton
      testID={`live-setting-${setting}`}
      title={`${title}：${value ? '开' : '关'}`}
      selected={value}
      onPress={() => void setValue(!value)}
    />
  );
}

/** LiveDialog plus the live switches of LiveSetting: pick the live source. */
export function LivePanel({
  lives,
  home,
  onSelect,
  onClose,
}: {
  lives: Live[];
  home: string;
  onSelect(live: Live): void;
  onClose(): void;
}) {
  return (
    <Sheet title="直播" testID="live-panel" onClose={onClose}>
      <Text style={styles.section}>直播源</Text>
      <ScrollView style={styles.list}>
        {lives.map((live, index) => (
          <FocusableButton
            key={`${index}-${live.name}`}
            testID={`live-source-${index}`}
            title={live.name}
            selected={live.name === home}
            hasTVPreferredFocus={live.name === home}
            onPress={() => onSelect(live)}
          />
        ))}
      </ScrollView>
      <Text style={styles.section}>设置</Text>
      <View style={styles.toggles}>
        <Toggle setting="invert" title="换台反转" />
        <Toggle setting="across" title="跨分类换台" />
        <Toggle setting="change" title="失败自动换源" />
      </View>
    </Sheet>
  );
}

/** PassDialog: unlocks the password-protected groups. */
export function PassPrompt({ onSubmit, onClose }: { onSubmit(pass: string): void; onClose(): void }) {
  const [pass, setPass] = useState('');
  return (
    <Sheet title="请输入密码" testID="live-pass" onClose={onClose}>
      <TextInput
        testID="live-pass-input"
        style={styles.input}
        value={pass}
        onChangeText={setPass}
        secureTextEntry
        autoFocus
        onSubmitEditing={() => onSubmit(pass)}
      />
      <FocusableButton testID="live-pass-ok" title="确定" onPress={() => onSubmit(pass)} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  panel: {
    maxHeight: '90%',
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  panelTV: {
    width: '50%',
  },
  panelPhone: {
    width: '90%',
  },
  title: {
    marginBottom: spacing.md,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  section: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  list: {
    maxHeight: 240,
  },
  toggles: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  input: {
    marginVertical: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.title,
  },
});
