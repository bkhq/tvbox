import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { splitHistoryKey } from '../../core/storage';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import { colors, FocusableButton, FocusableCard, FocusGrid, fontSize, radius, spacing, useLayout } from '../../ui';
import { ErrorView, LoadingView, useActiveCid } from '../common';

/** One History or Keep record as a card; `key` is `${siteKey}@@@${vodId}`. */
export interface RecordItem {
  key: string;
  vodName: string;
  vodPic: string;
  subtitle: string;
}

export interface RecordScreenProps {
  /** Screen title, shown in every state. */
  title: string;
  emptyText: string;
  /** testID prefix, e.g. "history". */
  testID: string;
  load: (cid: number) => Promise<RecordItem[]>;
  remove: (cid: number, key: string) => Promise<void>;
  /** Enables the "清空" action with this confirm question. */
  clear?: { confirm: string; run: (cid: number) => Promise<void> };
}

interface ListState {
  items: RecordItem[];
  loading: boolean;
  error?: Error;
}

/** Loads the records of `cid`, again on reload(); responses of an older request are dropped. */
function useRecords(cid: number | undefined, load: RecordScreenProps['load']) {
  const [state, setState] = useState<ListState>({ items: [], loading: true });
  const loadRef = useRef(load);
  const generation = useRef(0);

  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    const gen = ++generation.current;
    if (cid === undefined) return;
    loadRef.current(cid).then(
      (items) => gen === generation.current && setState({ items, loading: false }),
      (error: unknown) =>
        gen === generation.current &&
        setState({ items: [], loading: false, error: error instanceof Error ? error : new Error(String(error)) }),
    );
  }, [cid]);

  useEffect(() => {
    reload();
    const counter = generation;
    return () => {
      counter.current++;
    };
  }, [reload]);

  return { ...state, reload };
}

function Header({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      <View style={styles.toolbar}>{children}</View>
    </View>
  );
}

function RecordList({ cid, title, emptyText, testID, load, remove, clear }: RecordScreenProps & { cid: number }) {
  const navigation = useAppNavigation();
  const { columns } = useLayout();
  const { width } = useWindowDimensions();
  const list = useRecords(cid, load);
  const { reload } = list;
  const [editMode, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const empty = list.items.length === 0;
  // Nothing left to delete ends edit mode.
  const editing = editMode && !empty;

  // Returning from Detail or the player shows the updated records.
  useEffect(() => navigation.addListener('focus', reload), [navigation, reload]);

  // Back closes the confirm panel, then leaves edit mode, then pops the screen.
  useEffect(() => {
    if (!editing && !confirming) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (confirming) setConfirming(false);
      else setEditing(false);
      return true;
    });
    return () => subscription.remove();
  }, [editing, confirming]);

  const onPressItem = (item: RecordItem) => {
    if (editing) {
      void remove(cid, item.key).then(reload);
      return;
    }
    const { siteKey, vodId } = splitHistoryKey(item.key);
    navigation.navigate('Detail', { siteKey, vodId, vodName: item.vodName, vodPic: item.vodPic });
  };

  const onConfirmClear = () => {
    setConfirming(false);
    setEditing(false);
    if (clear) void clear.run(cid).then(reload);
  };

  // Grid padding on both sides, card margin on both sides of every card.
  const cardWidth = Math.max(80, Math.floor((width - spacing.md * 2) / columns) - spacing.xs * 2);
  const preferToolbar = !confirming && empty;

  let body;
  if (list.loading) body = <LoadingView />;
  else if (list.error) body = <ErrorView testID={`${testID}-error`} message={`加载失败：${list.error.message}`} onRetry={reload} />;
  else
    body = (
      <FocusGrid
        testID={`${testID}-grid`}
        data={list.items}
        columns={columns}
        keyExtractor={(item) => item.key}
        ListEmptyComponent={<Text style={styles.note}>{emptyText}</Text>}
        renderItem={({ item, index }) => (
          <FocusableCard
            testID={`${testID}-card-${item.key}`}
            title={item.vodName}
            subtitle={item.subtitle}
            poster={item.vodPic}
            width={cardWidth}
            hasTVPreferredFocus={!confirming && index === 0}
            onPress={() => onPressItem(item)}
          />
        )}
      />
    );

  return (
    <View style={styles.container}>
      <Header title={title}>
        {editing ? <Text style={styles.hint}>按卡片删除</Text> : null}
        <FocusableButton
          testID={`${testID}-edit`}
          title="删除"
          selected={editing}
          hasTVPreferredFocus={preferToolbar}
          onPress={() => setEditing(!editing)}
        />
        {clear ? <FocusableButton testID={`${testID}-clear`} title="清空" onPress={() => setConfirming(true)} /> : null}
      </Header>
      {confirming && clear ? (
        <View testID={`${testID}-confirm`} style={styles.confirm}>
          <Text style={styles.confirmText}>{clear.confirm}</Text>
          <View style={styles.toolbar}>
            <FocusableButton testID={`${testID}-confirm-ok`} title="确定" hasTVPreferredFocus onPress={onConfirmClear} />
            <FocusableButton testID={`${testID}-confirm-cancel`} title="取消" onPress={() => setConfirming(false)} />
          </View>
        </View>
      ) : null}
      {body}
    </View>
  );
}

/** History / Collect screen: a poster grid of records with an edit (delete) mode. */
export function RecordScreen(props: RecordScreenProps) {
  const { status } = useVodConfig();
  const cid = useActiveCid();
  if (cid !== undefined) return <RecordList key={cid} {...props} cid={cid} />;
  return (
    <View style={styles.container}>
      <Header title={props.title} />
      {status === 'loading' ? <LoadingView /> : <Text style={[styles.note, styles.padded]}>请先添加配置</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: fontSize.heading,
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  hint: {
    marginRight: spacing.sm,
    color: colors.textSecondary,
    fontSize: fontSize.caption,
  },
  confirm: {
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  confirmText: {
    marginBottom: spacing.sm,
    color: colors.text,
    fontSize: fontSize.body,
  },
  note: {
    marginVertical: spacing.xl,
    color: colors.textSecondary,
    fontSize: fontSize.body,
    textAlign: 'center',
  },
  padded: {
    paddingHorizontal: spacing.xl,
  },
});
