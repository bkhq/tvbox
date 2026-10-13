import { getKeepRepository } from '../../core/userData';
import type { Keep } from '../../core/types';
import {
  type RecordItem,
  RecordScreen,
  RecordView,
  type RecordViewProps,
  useRecordCount,
} from '../history/RecordScreen';

function toItem(keep: Keep): RecordItem {
  return { key: keep.key, vodName: keep.vodName, vodPic: keep.vodPic, subtitle: keep.siteName };
}

const load = async (cid: number) => (await getKeepRepository().list(cid)).map(toItem);

const collectProps: Omit<RecordViewProps, 'embedded' | 'hasTVPreferredFocus'> = {
  title: '我的片单',
  subtitle: '保存在本机',
  emptyText: '片单是空的。在详情页按「收藏」加入想看的内容。',
  testID: 'collect',
  card: 'poster',
  load,
  remove: (cid, key) => getKeepRepository().remove(key, cid),
};

/** The 我的片单 section, standalone or inside another screen's panel. */
export function CollectView(props: { embedded?: boolean; hasTVPreferredFocus?: boolean }) {
  return <RecordView {...collectProps} {...props} />;
}

/** Number of keeps of the active config; undefined without a config or while loading. */
export function useCollectCount(): number | undefined {
  return useRecordCount(collectProps.testID, load);
}

export default function CollectScreen() {
  // The route keeps its registered title; the 我的 panel shows the design one.
  return <RecordScreen {...collectProps} title="收藏" />;
}
