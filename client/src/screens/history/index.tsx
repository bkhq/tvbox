import { getHistoryRepository } from '../../core/userData';
import type { History } from '../../core/types';
import { type RecordItem, RecordScreen, RecordView, type RecordViewProps, useRecordCount } from './RecordScreen';

/** Playback position (ms) as m:ss, or h:mm:ss from one hour on. */
export function formatPosition(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${String(m).padStart(2, '0')}:${s}`;
}

function toItem(history: History): RecordItem {
  return {
    key: history.key,
    vodName: history.vodName,
    vodPic: history.vodPic,
    subtitle: history.position >= 0 ? `看到 ${formatPosition(history.position)}` : history.vodRemarks,
    progress: history.position > 0 && history.duration > 0 ? history.position / history.duration : undefined,
  };
}

const load = async (cid: number) => (await getHistoryRepository().list(cid)).map(toItem);

const historyProps: Omit<RecordViewProps, 'embedded' | 'hasTVPreferredFocus'> = {
  title: '观看历史',
  subtitle: '保存在本机',
  emptyText: '没有观看记录。',
  testID: 'history',
  card: 'wide',
  load,
  remove: (cid, key) => getHistoryRepository().delete(cid, key),
  clear: { confirm: '确定清空全部历史记录？', run: (cid) => getHistoryRepository().clear(cid) },
};

/** The 观看历史 section, standalone or inside another screen's panel. */
export function HistoryView(props: { embedded?: boolean; hasTVPreferredFocus?: boolean }) {
  return <RecordView {...historyProps} {...props} />;
}

/** Number of history records of the active config; undefined without a config or while loading. */
export function useHistoryCount(): number | undefined {
  return useRecordCount(historyProps.testID, load);
}

export default function HistoryScreen() {
  // The route keeps its registered title; the 我的 panel shows the design one.
  return <RecordScreen {...historyProps} title="历史记录" />;
}
