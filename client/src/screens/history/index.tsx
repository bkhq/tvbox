import { getHistoryRepository } from '../../core/userData';
import type { History } from '../../core/types';
import { type RecordItem, RecordScreen } from './RecordScreen';

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
  };
}

const load = async (cid: number) => (await getHistoryRepository().list(cid)).map(toItem);
const remove = (cid: number, key: string) => getHistoryRepository().delete(cid, key);
const clear = { confirm: '确定清空全部历史记录？', run: (cid: number) => getHistoryRepository().clear(cid) };

export default function HistoryScreen() {
  return <RecordScreen title="历史记录" emptyText="暂无历史记录" testID="history" load={load} remove={remove} clear={clear} />;
}
