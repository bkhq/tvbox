import { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';

import type { History } from '../../core/types';
import { getHistoryRepository, getKeepRepository } from '../../core/userData';
import { Button, color, radii, scaledText, space, useScaledStyles, type Scaler } from '../../ui';

export type ContinueMenuTarget = { kind: 'item'; history: History } | { kind: 'clear' };

/**
 * Long-press menu of a 继续观看 card (delete the record, add it to or remove it from 片单), or the confirmation of
 * 清空记录. Back closes it; `onChanged` runs after the history changed so the row re-reads it.
 */
export function ContinueMenu({
  target,
  cid,
  siteName,
  onClose,
  onChanged,
}: {
  target: ContinueMenuTarget;
  cid: number;
  siteName: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const styles = useScaledStyles(makeStyles);
  const history = target.kind === 'item' ? target.history : undefined;
  const [kept, setKept] = useState<boolean>();

  useEffect(() => {
    if (!history) return;
    let active = true;
    void getKeepRepository()
      .isKept(history.key, cid)
      .then((value) => active && setKept(value));
    return () => {
      active = false;
    };
  }, [history, cid]);

  const remove = async () => {
    if (history) await getHistoryRepository().delete(cid, history.key);
    onClose();
    onChanged();
  };
  const clear = async () => {
    await getHistoryRepository().clear(cid);
    onClose();
    onChanged();
  };
  const toggleKeep = async () => {
    if (!history || kept === undefined) return;
    const repository = getKeepRepository();
    if (kept) await repository.remove(history.key, cid);
    else await repository.add({ key: history.key, cid, siteName, vodName: history.vodName, vodPic: history.vodPic });
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View testID="home-continue-menu" style={styles.panel}>
          <Text numberOfLines={1} style={styles.title}>
            {history ? history.vodName : '清空观看记录？'}
          </Text>
          {history ? null : <Text style={styles.note}>继续观看中的全部记录都会删除。</Text>}
          <View style={styles.actions}>
            {history ? (
              <>
                <Button testID="home-continue-delete" title="删除记录" hasTVPreferredFocus onPress={() => void remove()} />
                <Button
                  testID="home-continue-keep"
                  title={kept ? '移出片单' : '加入片单'}
                  icon={kept ? 'check' : 'plus'}
                  disabled={kept === undefined}
                  onPress={() => void toggleKeep()}
                />
              </>
            ) : (
              <Button testID="home-continue-clear-confirm" title="清空" onPress={() => void clear()} />
            )}
            <Button
              testID="home-continue-menu-close"
              title="取消"
              // Clearing cannot be undone: start on 取消.
              hasTVPreferredFocus={!history}
              onPress={onClose}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    backdrop: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: 'rgba(11,14,20,0.7)',
    },
    panel: {
      width: s(880),
      padding: s(48),
      gap: s(space.md),
      borderRadius: s(radii.card),
      backgroundColor: color.surface,
    },
    title: { ...text.h1, color: color.text },
    note: { ...text.body, color: color.text2 },
    actions: { flexDirection: 'row' as const, gap: s(space.lg), marginTop: s(space.sm) },
  };
};
