import { getKeepRepository } from '../../core/userData';
import type { Keep } from '../../core/types';
import { type RecordItem, RecordScreen } from '../history/RecordScreen';

function toItem(keep: Keep): RecordItem {
  return { key: keep.key, vodName: keep.vodName, vodPic: keep.vodPic, subtitle: keep.siteName };
}

const load = async (cid: number) => (await getKeepRepository().list(cid)).map(toItem);
const remove = (cid: number, key: string) => getKeepRepository().remove(key, cid);

export default function CollectScreen() {
  return <RecordScreen title="收藏" emptyText="暂无收藏" testID="collect" load={load} remove={remove} />;
}
