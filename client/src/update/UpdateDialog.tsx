import { useEffect } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { UpdateController } from './controller';
import { installPhaseText } from './messages';
import { getUpdateController } from './updater';
import { useUpdateCheck } from './useUpdateCheck';
import { colors, FocusableButton, fontSize, radius, spacing } from '../ui';

export interface UpdateDialogProps {
  controller?: UpdateController;
}

/** Shows the pending release with 立即更新 / 稍后; renders nothing without one. */
export function UpdateDialog({ controller = getUpdateController() }: UpdateDialogProps) {
  const { release, installState: phase, install, dismiss } = useUpdateCheck(controller);
  if (!release) return null;

  const busy = phase.phase === 'downloading' || phase.phase === 'installing';
  const status = installPhaseText(phase);
  const primary = phase.phase === 'manual' ? null : phase.phase === 'error' ? '重试' : '立即更新';
  const secondary = busy ? '取消' : phase.phase === 'manual' ? '关闭' : '稍后';

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <View style={styles.backdrop}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{`发现新版本 v${release.versionName}`}</Text>
          <ScrollView style={styles.notes}>
            <Text style={styles.notesText}>{release.notes || '暂无更新说明'}</Text>
          </ScrollView>
          {status ? (
            <Text testID="update-status" style={[styles.status, phase.phase === 'error' && styles.error]}>
              {status}
            </Text>
          ) : null}
          <View style={styles.buttons}>
            {primary ? (
              <FocusableButton
                testID="update-install"
                title={primary}
                selected
                disabled={busy}
                hasTVPreferredFocus
                onPress={() => void install()}
              />
            ) : null}
            <FocusableButton
              testID="update-dismiss"
              title={secondary}
              hasTVPreferredFocus={!primary || busy}
              onPress={dismiss}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** Mount once at the app root: checks on launch and shows the dialog when a newer release exists. */
export function UpdatePrompt({ controller = getUpdateController() }: UpdateDialogProps) {
  useEffect(() => {
    void controller.check(false);
  }, [controller]);
  return <UpdateDialog controller={controller} />;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
  },
  dialog: {
    width: '80%',
    maxWidth: 560,
    maxHeight: '80%',
    padding: spacing.xl,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  title: {
    color: colors.text,
    fontSize: fontSize.heading,
    marginBottom: spacing.md,
  },
  notes: {
    flexGrow: 0,
    marginBottom: spacing.md,
  },
  notesText: {
    color: colors.textSecondary,
    fontSize: fontSize.body,
  },
  status: {
    color: colors.text,
    fontSize: fontSize.body,
    marginBottom: spacing.md,
  },
  error: {
    color: '#ff6b6b',
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
