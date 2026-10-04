import type { Vod } from '../../core/types';
import type { AppNavigation } from '../../navigation/types';

export function openVod(navigation: Pick<AppNavigation, 'navigate'>, siteKey: string, vod: Vod): void {
  navigation.navigate('Detail', { siteKey, vodId: vod.vod_id, vodName: vod.vod_name, vodPic: vod.vod_pic });
}
