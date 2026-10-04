import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { SERVER_LINK_STATE_TEXT, useServerLink } from '../../core/serverLink';
import { useSetting } from '../../core/settings';
import { colors, FocusableButton, fontSize, radius, spacing } from '../../ui';
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
  const preferred = options.find((option) => option.value === value && !option.disabled) ?? options.find((option) => !option.disabled);
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
  const [value, setValue] = useSetting(settingKey);
  return (
    <Panel title={title} onClose={onClose}>
      <View style={styles.stepper}>
        <FocusableButton
          testID="settings-step-down"
          title="－"
          hasTVPreferredFocus
          onPress={() => void setValue(stepValue(settingKey, value, -1))}
        />
        <Text testID="settings-step-value" style={styles.stepValue}>
          {STEPS[settingKey].format(value)}
        </Text>
        <FocusableButton testID="settings-step-up" title="＋" onPress={() => void setValue(stepValue(settingKey, value, 1))} />
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
  const [value, setValue] = useSetting(settingKey);
  const [text, setText] = useState(value);
  const save = () => {
    void setValue(text.trim());
    onClose();
  };
  return (
    <Panel title={title} onClose={onClose}>
      <Text style={styles.note}>{`当前：${formatText(value)}`}</Text>
      <TextInput
        testID="settings-text-input"
        style={styles.input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={save}
        placeholder={placeholder ?? '留空使用默认值'}
        placeholderTextColor={colors.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        hasTVPreferredFocus
      />
      <FocusableButton testID="settings-text-save" title="保存" onPress={save} />
    </Panel>
  );
}

/** Device link to the worker, mirroring EnrollDialog: request when off, refresh or unlink otherwise. */
export function ServerLinkPanel({ onClose }: { onClose: () => void }) {
  const { state, code, request, refresh, unlink } = useServerLink();
  return (
    <Panel title="服务器绑定" onClose={onClose}>
      <Text style={styles.code}>{`设备码：${code || '—'}`}</Text>
      <Text style={styles.note}>{`状态：${SERVER_LINK_STATE_TEXT[state]}`}</Text>
      <Text style={styles.note}>请在管理后台批准此设备码</Text>
      <View style={styles.actions}>
        {state === 'OFF' ? (
          <FocusableButton testID="settings-link-request" title="绑定" hasTVPreferredFocus onPress={() => void request()} />
        ) : (
          <>
            <FocusableButton testID="settings-link-refresh" title="刷新" hasTVPreferredFocus onPress={() => void refresh()} />
            <FocusableButton testID="settings-link-unlink" title="解绑" onPress={() => void unlink()} />
          </>
        )}
      </View>
    </Panel>
  );
}

const styles = StyleSheet.create({
  note: {
    marginVertical: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  code: {
    color: colors.text,
    fontSize: fontSize.display,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    minWidth: 96,
    textAlign: 'center',
    color: colors.text,
    fontSize: fontSize.heading,
  },
  input: {
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: fontSize.body,
  },
  actions: {
    flexDirection: 'row',
    marginTop: spacing.md,
  },
});
