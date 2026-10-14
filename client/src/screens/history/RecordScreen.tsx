import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, Text, TVFocusGuideView, View } from 'react-native';

import { useVodConfig } from '../../core/bootstrap';
import { splitHistoryKey } from '../../core/storage';
// Not the navigation barrel: it imports the route table, which imports this screen.
import { useAppNavigation } from '../../navigation/useAppNavigation';
import {
  BackButton,
  Button,
  card as cardTokens,
  color,
  focus,
  Grid,
  PosterCard,
  safeArea,
  scaledText,
  type Scaler,
  useScaledStyles,
  WideCard,
} from '../../ui';
import { ErrorView, LoadingView, useActiveCid } from '../common';
// A leaf module: the settings screen embeds this view, so its barrel would be a cycle.
import { FocusEntry } from '../settings/entryFocus';

/** One History or Keep record as a card; `key` is `${siteKey}@@@${vodId}`. */
export interface RecordItem {
  key: string;
  vodName: string;
  vodPic: string;
  subtitle: string;
  /** Watched fraction 0..1, drawn on wide cards. */
  progress?: number;
}

export interface RecordViewProps {
  /** Section title, shown in every state. */
  title: string;
  subtitle: string;
  emptyText: string;
  /** testID prefix and change-notification channel, e.g. "history". */
  testID: string;
  /** wide: 16:9 WideCards; poster: 2:3 PosterCards. */
  card: 'wide' | 'poster';
  load: (cid: number) => Promise<RecordItem[]>;
  remove: (cid: number, key: string) => Promise<void>;
  /** Enables the "清除记录" action with this confirm question. */
  clear?: { confirm: string; run: (cid: number) => Promise<void> };
  /** Inside another screen's panel instead of filling its own route. */
  embedded?: boolean;
  /** Lets the view take the initial focus; defaults to true when standalone. */
  hasTVPreferredFocus?: boolean;
}

// Records of a channel ("history", "collect") changed; every view and count of it reloads.
const changeListeners = new Map<string, Set<() => void>>();

function notifyRecordsChanged(channel: string) {
  changeListeners.get(channel)?.forEach((listener) => listener());
}

function subscribeRecords(channel: string, listener: () => void) {
  const listeners = changeListeners.get(channel) ?? new Set();
  changeListeners.set(channel, listeners);
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

interface ListState {
  /** cid the items belong to; differs from the requested cid while loading. */
  cid?: number;
  items: RecordItem[];
  error?: Error;
}

/**
 * Loads the records of `cid`, again on reload(), on screen focus and on a change notification of
 * `channel`; responses of an older request are dropped.
 */
function useRecords(channel: string, cid: number | undefined, load: RecordViewProps['load']) {
  const navigation = useAppNavigation();
  const [state, setState] = useState<ListState>({ items: [] });
  const loadRef = useRef(load);
  const generation = useRef(0);

  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    const gen = ++generation.current;
    if (cid === undefined) return;
    loadRef.current(cid).then(
      (items) => gen === generation.current && setState({ cid, items }),
      (error: unknown) =>
        gen === generation.current &&
        setState({ cid, items: [], error: error instanceof Error ? error : new Error(String(error)) }),
    );
  }, [cid]);

  useEffect(() => {
    reload();
    const counter = generation;
    return () => {
      counter.current++;
    };
  }, [reload]);

  // Returning from Detail or the player shows the updated records.
  useEffect(() => navigation.addListener('focus', reload), [navigation, reload]);
  useEffect(() => subscribeRecords(channel, reload), [channel, reload]);

  return { items: state.items, error: state.error, loading: state.cid !== cid, reload };
}

/** Number of records of the active config; undefined without a config or while loading. */
export function useRecordCount(channel: string, load: RecordViewProps['load']): number | undefined {
  const cid = useActiveCid();
  const { items, error, loading } = useRecords(channel, cid, load);
  return cid === undefined || loading || error ? undefined : items.length;
}

function Header({
  title,
  subtitle,
  guide,
  children,
}: {
  title: string;
  subtitle: string;
  /** Spans the actions across the header so D-pad up from any card reaches them. */
  guide?: boolean;
  children?: ReactNode;
}) {
  const styles = useScaledStyles(makeStyles);
  const Container = guide ? TVFocusGuideView : View;
  return (
    <Container testID="record-header" autoFocus={guide || undefined} style={styles.header}>
      <View style={styles.heading}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <View style={styles.actions}>{children}</View>
    </Container>
  );
}

function EmptyCard({ text }: { text: string }) {
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

// Width the cards share: the 我的 right panel, or the screen inside the safe area.
const EMBEDDED_WIDTH = 1216;
const STANDALONE_WIDTH = 1920 - safeArea.horizontal * 2;
const EMBEDDED_COLUMNS = { wide: 4, poster: 5 } as const;
const STANDALONE_COLUMNS = { wide: cardTokens.wideColumns, poster: cardTokens.posterColumns } as const;
const DEFAULT_WIDTH = { wide: cardTokens.wide.width, poster: cardTokens.poster.width } as const;

/** Card width in design px that fits `columns` cards with gaps into `available`, at most the default size. */
function fitCardWidth(kind: RecordViewProps['card'], available: number, columns: number): number {
  return Math.min(DEFAULT_WIDTH[kind], Math.floor((available - cardTokens.rowGap * (columns - 1)) / columns));
}

function RecordList({
  cid,
  title,
  subtitle,
  emptyText,
  testID,
  card,
  load,
  remove,
  clear,
  embedded = false,
  hasTVPreferredFocus = !embedded,
}: RecordViewProps & { cid: number }) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  const list = useRecords(testID, cid, load);
  const { reload } = list;
  const [editMode, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const empty = list.items.length === 0;
  // Nothing left to delete ends edit mode.
  const editing = editMode && !empty;

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
      void remove(cid, item.key).then(() => notifyRecordsChanged(testID));
      return;
    }
    const { siteKey, vodId } = splitHistoryKey(item.key);
    navigation.navigate('Detail', { siteKey, vodId, vodName: item.vodName, vodPic: item.vodPic });
  };

  const onConfirmClear = () => {
    setConfirming(false);
    setEditing(false);
    if (clear) void clear.run(cid).then(() => notifyRecordsChanged(testID));
  };

  const prefer = hasTVPreferredFocus && !confirming;
  const columns = (embedded ? EMBEDDED_COLUMNS : STANDALONE_COLUMNS)[card];
  const cardWidth = fitCardWidth(card, embedded ? EMBEDDED_WIDTH : STANDALONE_WIDTH, columns);

  const renderItem = ({ item, index }: { item: RecordItem; index: number }) => {
    const common = {
      testID: `${testID}-card-${item.key}`,
      title: item.vodName,
      width: cardWidth,
      hasTVPreferredFocus: prefer && index === 0,
      onPress: () => onPressItem(item),
    };
    return (
      // Entering the 我的 panel lands on the first card.
      <FocusEntry enabled={index === 0}>
        {card === 'wide' ? (
          <WideCard {...common} subtitle={item.subtitle} image={item.vodPic} progress={item.progress} />
        ) : (
          <PosterCard {...common} meta={item.subtitle} poster={item.vodPic} />
        )}
      </FocusEntry>
    );
  };

  let body;
  if (list.loading) body = <LoadingView />;
  else if (list.error)
    body = (
      <ErrorView
        testID={`${testID}-error`}
        message={`加载失败：${list.error.message}`}
        hasTVPreferredFocus={prefer}
        onRetry={reload}
      />
    );
  else if (embedded)
    body = (
      // The panel owns no scroll view; this list scrolls the grid itself.
      <FlatList
        testID={`${testID}-grid`}
        data={list.items}
        numColumns={columns}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListEmptyComponent={<EmptyCard text={emptyText} />}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        columnWrapperStyle={styles.listColumns}
      />
    );
  else
    body = (
      <Grid
        testID={`${testID}-grid`}
        variant={card}
        data={list.items}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        ListEmptyComponent={<EmptyCard text={emptyText} />}
      />
    );

  return (
    <View style={[styles.view, !embedded && styles.standalone]}>
      <View style={[styles.top, !embedded && styles.inset]}>
        {/* Embedded, up from the first cards would skip the actions on the right for the top bar. */}
        <Header title={title} subtitle={subtitle} guide={embedded}>
          {editing ? <Text style={styles.hint}>按卡片删除</Text> : null}
          <FocusEntry enabled={empty}>
            <Button
              testID={`${testID}-edit`}
              title="删除"
              size="md"
              variant={editing ? 'primary' : 'secondary'}
              hasTVPreferredFocus={prefer && empty}
              onPress={() => setEditing(!editing)}
            />
          </FocusEntry>
          {clear ? (
            <Button testID={`${testID}-clear`} title="清除记录" size="md" onPress={() => setConfirming(true)} />
          ) : null}
        </Header>
        {confirming && clear ? (
          <View testID={`${testID}-confirm`} style={styles.confirm}>
            <Text style={styles.confirmText}>{clear.confirm}</Text>
            <View style={styles.actions}>
              <Button
                testID={`${testID}-confirm-ok`}
                title="确定"
                size="md"
                variant="primary"
                hasTVPreferredFocus
                onPress={onConfirmClear}
              />
              <Button testID={`${testID}-confirm-cancel`} title="取消" size="md" onPress={() => setConfirming(false)} />
            </View>
          </View>
        ) : null}
      </View>
      {body}
    </View>
  );
}

/** History / Collect section: a card grid of records with an edit (delete) mode. */
export function RecordView(props: RecordViewProps) {
  const { status } = useVodConfig();
  const cid = useActiveCid();
  const styles = useScaledStyles(makeStyles);
  if (cid !== undefined) return <RecordList key={cid} {...props} cid={cid} />;
  const embedded = props.embedded ?? false;
  return (
    <View style={[styles.view, !embedded && styles.standalone]}>
      <View style={[styles.top, !embedded && styles.inset]}>
        <Header title={props.title} subtitle={props.subtitle} />
        {status === 'loading' ? null : <EmptyCard text="请先添加配置" />}
      </View>
      {status === 'loading' ? <LoadingView /> : null}
    </View>
  );
}

/** History / Collect route: the standalone view under a back button. */
export function RecordScreen(props: Omit<RecordViewProps, 'embedded'>) {
  const navigation = useAppNavigation();
  const styles = useScaledStyles(makeStyles);
  return (
    <View style={styles.screen}>
      <BackButton testID={`${props.testID}-back`} style={styles.back} onPress={() => navigation.goBack()} />
      <RecordView {...props} />
    </View>
  );
}

const makeStyles = (s: Scaler) => {
  const text = scaledText(s);
  return {
    screen: { flex: 1, backgroundColor: color.bg, paddingTop: s(safeArea.vertical), gap: s(28) },
    back: { marginLeft: s(safeArea.horizontal) },
    view: { flex: 1, gap: s(28) },
    standalone: { backgroundColor: color.bg },
    top: { gap: s(28) },
    inset: { paddingHorizontal: s(safeArea.horizontal) },
    header: { flexDirection: 'row' as const, alignItems: 'flex-end' as const, gap: s(24) },
    heading: { flex: 1, gap: s(8) },
    title: { ...text.h1, color: color.text },
    subtitle: { ...text.caption, fontSize: s(22), lineHeight: s(30), color: color.text3 },
    actions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: s(16) },
    hint: { ...text.caption, color: color.text2 },
    confirm: { gap: s(24), padding: s(32), borderRadius: s(16), backgroundColor: color.surface },
    confirmText: { ...text.body, color: color.text },
    empty: { padding: s(48), borderRadius: s(16), backgroundColor: color.surface },
    emptyText: { ...text.label, color: color.text2 },
    // The vertical bleed keeps the focus zoom of the edge rows unclipped.
    list: { overflow: 'visible' as const },
    listContent: { paddingVertical: s(focus.bleed), gap: s(40) },
    listColumns: { gap: s(cardTokens.rowGap) },
  };
};
