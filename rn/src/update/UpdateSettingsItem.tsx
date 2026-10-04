import { StyleSheet, Text, View } from 'react-native';

import type { UpdateController } from './controller';
import { checkResultText } from './messages';
import { getUpdateController } from './updater';
import { useUpdateCheck } from './useUpdateCheck';
import { getAppConfig } from '../core/appConfig';
import { colors, FocusableButton, fontSize, spacing } from '../ui';

export interface UpdateSettingsItemProps {
  controller?: UpdateController;
  versionName?: string;
  hasTVPreferredFocus?: boolean;
}

/** Settings row: 检查更新 button, current version and the last manual result. */
export function UpdateSettingsItem({
  controller = getUpdateController(),
  versionName = getAppConfig().versionName,
  hasTVPreferredFocus,
}: UpdateSettingsItemProps) {
  const { checking, lastResult, check } = useUpdateCheck(controller);
  return (
    <View style={styles.row}>
      <FocusableButton
        testID="update-check"
        title={checking ? '正在检查…' : '检查更新'}
        disabled={checking}
        hasTVPreferredFocus={hasTVPreferredFocus}
        onPress={() => void check(true)}
      />
      <Text style={styles.version}>{`v${versionName}`}</Text>
      {lastResult && !checking ? (
        <Text testID="update-result" style={styles.result}>
          {checkResultText(lastResult)}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  version: {
    color: colors.text,
    fontSize: fontSize.body,
    marginHorizontal: spacing.md,
  },
  result: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
});
