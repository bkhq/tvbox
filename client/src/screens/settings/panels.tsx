import { useState } from 'react';
import { Text, View } from 'react-native';

import { SERVER_LINK_STATE_TEXT, useServerLink } from '../../core/serverLink';
import { useSetting } from '../../core/settings';
import { Button, color, fontFamily, scaledText, tabular, useScaledStyles, type Scaler } from '../../ui';
import { FocusableInput } from '../common';
import { formatText, STEPS, stepValue, type StepKey, type TextKey } from './options';
import { Panel } from './Panel';
import { SettingRow } from './SettingRow';

export interface PickerOption<T> {
  value: T;
  label: string;
  disabled?: boolean;
  note?: string;
}

/** Single-choice list; focus starts on the current value. */
export function OptionPanel<T>({
  title,
  options,
  value,
  onSelect,
  onClose,
  testIDPrefix,
}: {
  title: string;
  options: readonly PickerOption<T>[];
  value: T | undefined;
  onSelect: (value: T) => void;
  onClose: () => void;
  testIDPrefix: string;
}) {
  const styles = useScaledStyles(makePanelStyles);
  const preferred =
    options.find((option) => option.value === value && !option.disabled) ?? options.find((option) => !option.disabled);
  return (
    <Panel title={title} onClose={onClose}>
      {options.map((option) => (
        <SettingRow
          key={String(option.value)}
          testID={`${testIDPrefix}-${String(option.value)}`}
          title={option.label}
          note={option.note}
          disabled={option.disabled}
          selected={option.value === value}
          hasTVPreferredFocus={option === preferred}
          onPress={() => onSelect(option.value)}
        />
      ))}
      {options.length === 0 ? <Text style={styles.note}>没有可选项</Text> : null}
    </Panel>
  );
}

/** -/+ editor for a numeric setting; the schema clamps the result. */
export function StepPanel({ settingKey, title, onClose }: { settingKey: StepKey; title: string; onClose: () => void }) {
  const styles = useScaledStyles(makePanelStyles);
  const [value, setValue] = useSetting(settingKey);
  return (
    <Panel title={title} onClose={onClose}>
      <View style={styles.stepper}>
        <Button
          testID="settings-step-down"
          title="－"
          size="md"
          hasTVPreferredFocus
          onPress={() => void setValue(stepValue(settingKey, value, -1))}
        />
        <Text testID="settings-step-value" style={styles.stepValue}>
          {STEPS[settingKey].format(value)}
        </Text>
        <Button
          testID="settings-step-up"
          title="＋"
          size="md"
          onPress={() => void setValue(stepValue(settingKey, value, 1))}
        />
      </View>
    </Panel>
  );
}

export function TextPanel({
  settingKey,
  title,
  placeholder,
  onClose,
}: {
  settingKey: TextKey;
  title: string;
  placeholder?: string;
  onClose: () => void;
}) {
  const styles = useScaledStyles(makePanelStyles);
  const [value, setValue] = useSetting(settingKey);
  const [text, setText] = useState(value);
  const save = () => {
    void setValue(text.trim());
    onClose();
  };
  return (
    <Panel title={title} onClose={onClose}>
      <Text style={styles.note}>{`当前：${formatText(value)}`}</Text>
      <FocusableInput
        testID="settings-text-input"
        style={styles.input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={save}
        placeholder={placeholder ?? '留空使用默认值'}
        placeholderTextColor={color.text3}
        autoCapitalize="none"
        autoCorrect={false}
        hasTVPreferredFocus
      />
      <Button testID="settings-text-save" title="保存" size="md" style={styles.action} onPress={save} />
    </Panel>
  );
}

/** Device link to the worker, mirroring EnrollDialog: request when off, refresh or unlink otherwise. */
export function ServerLinkPanel({ onClose }: { onClose: () => void }) {
  const styles = useScaledStyles(makePanelStyles);
  const { state, code, request, refresh, unlink } = useServerLink();
  return (
    <Panel title="服务器绑定" onClose={onClose}>
      <Text style={styles.code}>{`设备码：${code || '—'}`}</Text>
      <Text style={styles.note}>{`状态：${SERVER_LINK_STATE_TEXT[state]}`}</Text>
      <Text style={styles.note}>请在管理后台批准此设备码</Text>
      <View style={styles.actions}>
        {state === 'OFF' ? (
          <Button
            testID="settings-link-request"
            title="绑定"
            size="md"
            hasTVPreferredFocus
            onPress={() => void request()}
          />
        ) : (
          <>
            <Button
              testID="settings-link-refresh"
              title="刷新"
              size="md"
              hasTVPreferredFocus
              onPress={() => void refresh()}
            />
            <Button testID="settings-link-unlink" title="解绑" size="md" onPress={() => void unlink()} />
          </>
        )}
      </View>
    </Panel>
  );
}

/** Shared by the editor panels of the settings screen. */
export const makePanelStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    note: { ...text.label, color: color.text2 },
    code: { ...text.h1, ...tabular, color: color.text },
    stepper: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: s(24),
    },
    stepValue: { ...text.h2, ...tabular, minWidth: s(160), textAlign: 'center' as const, color: color.text },
    input: {
      minHeight: s(64),
      paddingHorizontal: s(24),
      paddingVertical: s(12),
      borderRadius: s(12),
      backgroundColor: color.surface2,
      color: color.text,
      fontFamily: fontFamily.medium,
      fontSize: s(24),
    },
    action: { alignSelf: 'flex-start' as const },
    actions: { flexDirection: 'row' as const, gap: s(24) },
  };
};
