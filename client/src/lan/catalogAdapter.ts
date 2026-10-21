import { type Bootstrap, getBootstrap } from '../core/bootstrap';
import { getProvider, type SiteProvider } from '../core/provider';
import { appSettings } from '../core/settings';
import type { SettingsStore } from '../core/settings/settings';
import { type HistoryRepository, historyKey, type KeepRepository, splitHistoryKey } from '../core/storage';
import { parseFlags, type Site, type Vod } from '../core/types';
import { getHistoryRepository, getKeepRepository } from '../core/userData';
import { parseWords } from '../screens/search/history';
import { searchSites, searchTargets } from '../screens/search/searchSites';
import { type LanCatalog, LanCatalogError, type LanLibraryItem, type LanSearchSnapshot, type LanVodSummary } from './ports';

export interface LanCatalogDeps {
  bootstrap?: Pick<Bootstrap, 'getSnapshot'>;
  settings?: Pick<SettingsStore, 'get'>;
  history?: HistoryRepository;
  keeps?: KeepRepository;
  provider?: (site: Site) => SiteProvider;
}

const summary = (vod: Vod): LanVodSummary => ({
  id: vod.vod_id,
  name: vod.vod_name,
  pic: vod.vod_pic,
  remarks: vod.vod_remarks,
  year: vod.vod_year,
  type: vod.type_name,
});

const EMPTY_SEARCH: LanSearchSnapshot = { groups: [], completed: 0, total: 0, done: true };

/** LanCatalog on the active VOD config: site providers, watch history and favourites. */
export function createLanCatalog(deps: LanCatalogDeps = {}): LanCatalog {
  const bootstrap = deps.bootstrap ?? getBootstrap();
  const settings = deps.settings ?? appSettings;
  const provider = deps.provider ?? ((site: Site) => getProvider(site));
  const history = () => deps.history ?? getHistoryRepository();
  const keeps = () => deps.keeps ?? getKeepRepository();

  const sites = () => bootstrap.getSnapshot().config?.sites ?? [];
  const cid = () => bootstrap.getSnapshot().entry?.id;
  const siteName = (key: string) => sites().find((site) => site.key === key)?.name || key;

  return {
    search(keyword, quick) {
      let snapshot = EMPTY_SEARCH;
      const handle = searchSites(
        searchTargets(sites(), quick),
        (site) => provider(site).search(keyword, quick),
        ({ groups, completed, total, done }) => {
          snapshot = {
            groups: groups.map(({ site, list }) => ({ site: { key: site.key, name: site.name }, list: list.map(summary) })),
            completed,
            total,
            done,
          };
        },
      );
      return { snapshot: () => snapshot, cancel: handle.cancel };
    },

    async detail(siteKey, vodId) {
      const site = sites().find((item) => item.key === siteKey);
      if (!site) throw new LanCatalogError(404, 'site not found');
      if (!site.supported) throw new LanCatalogError(400, 'site not supported');
      const vod = (await provider(site).detail([vodId])).list[0];
      if (!vod) throw new LanCatalogError(404, 'vod not found');
      const flags = parseFlags(vod);
      const id = cid();
      const record = id === undefined ? undefined : await history().get(id, historyKey(siteKey, vodId));
      const saved = record && flags.find((flag) => flag.flag === record.vodFlag)?.episodes.find((episode) => episode.url === record.episodeUrl);
      return {
        site: { key: site.key, name: site.name },
        vod: { ...summary(vod), area: vod.vod_area, director: vod.vod_director, actor: vod.vod_actor, content: vod.vod_content },
        flags: flags.map((flag) => ({ flag: flag.flag, episodes: flag.episodes.map(({ name, url }) => ({ name, url })) })),
        ...(record && saved
          ? { resume: { flag: record.vodFlag, episodeUrl: record.episodeUrl, position: record.position, duration: record.duration } }
          : {}),
      };
    },

    async history() {
      const id = cid();
      if (id === undefined) return [];
      return (await history().list(id)).map((item): LanLibraryItem => {
        const { siteKey, vodId } = splitHistoryKey(item.key);
        return {
          siteKey,
          siteName: siteName(siteKey),
          id: vodId,
          name: item.vodName,
          pic: item.vodPic,
          remarks: item.vodRemarks,
          year: '',
          type: '',
          flag: item.vodFlag,
          episodeUrl: item.episodeUrl,
          position: item.position,
          duration: item.duration,
          time: item.createTime,
        };
      });
    },

    async keeps() {
      const id = cid();
      if (id === undefined) return [];
      return (await keeps().list(id)).map((item): LanLibraryItem => {
        const { siteKey, vodId } = splitHistoryKey(item.key);
        return {
          siteKey,
          siteName: item.siteName || siteName(siteKey),
          id: vodId,
          name: item.vodName,
          pic: item.vodPic,
          remarks: '',
          year: '',
          type: '',
          time: item.createTime,
        };
      });
    },

    async words() {
      return { history: parseWords(settings.get('keyword')), hot: parseWords(settings.get('hot')) };
    },
  };
}
