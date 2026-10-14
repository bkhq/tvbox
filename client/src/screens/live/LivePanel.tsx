import { type ReactNode, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, View } from 'react-native';

import { useSetting } from '../../core/settings/useSetting';
import type { Live } from '../../core/types';
import { Button, Chip, color, focus, radii, type Scaler, scaledText, space, useScaledStyles } from '../../ui';

type Styles = ReturnType<typeof makeStyles>;

function Sheet({
  title,
  testID,
  styles,
  onClose,
  children,
}: {
  title: string;
  testID: string;
  styles: Styles;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID={testID} style={styles.panel}>
          <Text style={styles.title}>{title}</Text>
          {children}
          <View style={styles.footer}>
            <Button testID="live-panel-close" title="关闭" size="md" onPress={onClose} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

function Toggle({ setting, title }: { setting: 'invert' | 'across' | 'change'; title: string }) {
  const [value, setValue] = useSetting(setting);
  return (
    <Chip
      testID={`live-setting-${setting}`}
      label={`${title}：${value ? '开' : '关'}`}
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
  const styles = useScaledStyles(makeStyles);
  return (
    <Sheet title="直播" testID="live-panel" styles={styles} onClose={onClose}>
      <Text style={styles.section}>直播源</Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.chips}>
        {lives.map((live, index) => (
          <Chip
            key={`${index}-${live.name}`}
            testID={`live-source-${index}`}
            label={live.name}
            selected={live.name === home}
            hasTVPreferredFocus={live.name === home}
            onPress={() => onSelect(live)}
          />
        ))}
      </ScrollView>
      <Text style={styles.section}>设置</Text>
      <View style={styles.chips}>
        <Toggle setting="invert" title="换台反转" />
        <Toggle setting="across" title="跨分类换台" />
        <Toggle setting="change" title="失败自动换源" />
      </View>
    </Sheet>
  );
}

/** PassDialog: unlocks the password-protected groups. */
export function PassPrompt({ onSubmit, onClose }: { onSubmit(pass: string): void; onClose(): void }) {
  const styles = useScaledStyles(makeStyles);
  const [pass, setPass] = useState('');
  return (
    <Sheet title="请输入密码" testID="live-pass" styles={styles} onClose={onClose}>
      <TextInput
        testID="live-pass-input"
        style={styles.input}
        value={pass}
        onChangeText={setPass}
        secureTextEntry
        autoFocus
        onSubmitEditing={() => onSubmit(pass)}
      />
      <View style={styles.actions}>
        <Button testID="live-pass-ok" variant="primary" title="确定" size="md" onPress={() => onSubmit(pass)} />
      </View>
    </Sheet>
  );
}

const makeStyles = (s: Scaler) => {
  const t = scaledText(s);
  return {
    backdrop: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: 'rgba(11,14,20,0.6)',
    },
    panel: {
      width: s(960),
      maxWidth: '90%' as const,
      maxHeight: '90%' as const,
      padding: s(48),
      borderRadius: s(20),
      borderWidth: s(1),
      borderColor: color.divider,
      backgroundColor: color.surface,
    },
    title: { ...t.h1, marginBottom: s(space.sm), color: color.text },
    section: { ...t.label, marginTop: s(space.md), marginBottom: s(space.xs), color: color.text3 },
    list: { maxHeight: s(400), flexGrow: 0 },
    chips: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: s(space.sm), padding: s(focus.bleed) },
    actions: { flexDirection: 'row' as const, marginBottom: s(space.sm) },
    footer: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, marginTop: s(space.md) },
    input: {
      ...t.h2,
      marginVertical: s(space.md),
      paddingHorizontal: s(space.md),
      height: s(76),
      borderRadius: s(radii.button),
      backgroundColor: color.surface2,
      color: color.text,
    },
  };
};
