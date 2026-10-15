import type { Vod } from '../../core/types';
import type { AppNavigation } from '../../navigation/types';

/** A chart entry with metadata only (`msearch:` id, TVBox's convention): opening it searches every site for its name. */
export function isSearchVod(vod: Vod): boolean {
  return vod.vod_id.startsWith('msearch:');
}

export function openVod(navigation: Pick<AppNavigation, 'navigate'>, siteKey: string, vod: Vod): void {
  if (isSearchVod(vod)) navigation.navigate('Search', { keyword: vod.vod_name });
  else navigation.navigate('Detail', { siteKey, vodId: vod.vod_id, vodName: vod.vod_name, vodPic: vod.vod_pic });
}
