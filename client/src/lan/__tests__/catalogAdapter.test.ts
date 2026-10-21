import type { VodConfig } from '../../core/config/vodConfig';
import type { SiteProvider } from '../../core/provider';
import { createSettingsStore } from '../../core/settings/settings';
import { createHistoryRepository, createKeepRepository, historyKey, MemoryStore } from '../../core/storage';
import type { Result, Site, Vod } from '../../core/types';
import { createLanCatalog } from '../catalogAdapter';
import { LanCatalogError } from '../ports';
import { site } from '../__fixtures__/fakes';

const vod = (id: string, extra: Partial<Vod> = {}): Vod =>
  ({ vod_id: id, vod_name: `Vod ${id}`, vod_pic: `https://img.example/${id}.jpg`, vod_remarks: '更新至2集', vod_year: '2024', type_name: '剧集', vod_area: '中国', vod_director: 'D', vod_actor: 'A', vod_content: 'C', vod_play_from: 'line1$$$line2', vod_play_url: '第1集$e1#第2集$e2$$$第1集$f1', ...extra }) as Vod;
const result = (list: Vod[]) => ({ list }) as unknown as Result;

function build(sites: Site[] = [site('a'), site('b'), site('jar', false)], entry: { id: number } | undefined = { id: 7 }) {
  const store = new MemoryStore();
  const history = createHistoryRepository(store, () => 1_000);
  const keeps = createKeepRepository(store, () => 2_000);
  const settings = createSettingsStore(store);
  const providers = new Map<string, Partial<SiteProvider>>();
  const catalog = createLanCatalog({
    bootstrap: { getSnapshot: () => ({ status: 'ready', config: { sites } as unknown as VodConfig, entry: entry as never }) },
    settings,
    history,
    keeps,
    provider: (target) => (providers.get(target.key) ?? {}) as SiteProvider,
  });
  return { catalog, history, keeps, settings, providers };
}

describe('createLanCatalog', () => {
  it('searches every searchable supported site and maps the groups', async () => {
    const { catalog, providers } = build();
    let resolveB!: (value: Result) => void;
    providers.set('a', { search: jest.fn(async () => result([vod('a1')])) });
    providers.set('b', { search: () => new Promise<Result>((resolve) => (resolveB = resolve)) });
    const session = catalog.search('三体', false);
    expect(session.snapshot()).toEqual({ groups: [], completed: 0, total: 2, done: false });
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(session.snapshot()).toMatchObject({ completed: 1, done: false, groups: [{ site: { key: 'a', name: 'Site a' }, list: [{ id: 'a1', name: 'Vod a1', year: '2024', remarks: '更新至2集', type: '剧集' }] }] });
    resolveB(result([]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(session.snapshot()).toMatchObject({ completed: 2, done: true });
    expect(session.snapshot().groups).toHaveLength(1);
    expect(providers.get('a')!.search).toHaveBeenCalledWith('三体', false);
  });

  it('searches nothing without a config', async () => {
    const { catalog } = build([], undefined);
    expect(catalog.search('x', false).snapshot()).toEqual({ groups: [], completed: 0, total: 0, done: true });
  });

  it('answers the detail with lines, episodes and the saved episode', async () => {
    const { catalog, providers, history } = build();
    providers.set('a', { detail: jest.fn(async () => result([vod('a1')])) });
    expect(await catalog.detail('a', 'a1')).toEqual({
      site: { key: 'a', name: 'Site a' },
      vod: { id: 'a1', name: 'Vod a1', pic: 'https://img.example/a1.jpg', remarks: '更新至2集', year: '2024', type: '剧集', area: '中国', director: 'D', actor: 'A', content: 'C' },
      flags: [
        { flag: 'line1', episodes: [{ name: '第1集', url: 'e1' }, { name: '第2集', url: 'e2' }] },
        { flag: 'line2', episodes: [{ name: '第1集', url: 'f1' }] },
      ],
    });
    expect(providers.get('a')!.detail).toHaveBeenCalledWith(['a1']);
    await history.upsert({ key: historyKey('a', 'a1'), cid: 7, vodFlag: 'line1', episodeUrl: 'e2', position: 5_000, duration: 9_000 });
    expect((await catalog.detail('a', 'a1')).resume).toEqual({ flag: 'line1', episodeUrl: 'e2', position: 5_000, duration: 9_000 });
    await history.upsert({ key: historyKey('a', 'a1'), cid: 7, vodFlag: 'gone', episodeUrl: 'e2' });
    expect((await catalog.detail('a', 'a1')).resume).toBeUndefined();
  });

  it('rejects unknown, unsupported and empty vods', async () => {
    const { catalog, providers } = build();
    providers.set('a', { detail: async () => result([]) });
    await expect(catalog.detail('x', '1')).rejects.toEqual(new LanCatalogError(404, 'site not found'));
    await expect(catalog.detail('jar', '1')).rejects.toEqual(new LanCatalogError(400, 'site not supported'));
    await expect(catalog.detail('a', '1')).rejects.toEqual(new LanCatalogError(404, 'vod not found'));
  });

  it('lists the history and favourites of the active config', async () => {
    const { catalog, history, keeps } = build();
    await history.upsert({ key: historyKey('a', 'a1'), cid: 7, vodName: 'Vod a1', vodPic: 'p', vodFlag: 'line1', vodRemarks: '第2集', episodeUrl: 'e2', position: 5_000, duration: 9_000 });
    await history.upsert({ key: historyKey('a', 'other'), cid: 8, vodName: 'Other' });
    await keeps.add({ key: historyKey('b', 'b1'), cid: 7, siteName: '', vodName: 'Vod b1', vodPic: 'q' });
    expect(await catalog.history()).toEqual([
      { siteKey: 'a', siteName: 'Site a', id: 'a1', name: 'Vod a1', pic: 'p', remarks: '第2集', year: '', type: '', flag: 'line1', episodeUrl: 'e2', position: 5_000, duration: 9_000, time: 1_000 },
    ]);
    expect(await catalog.keeps()).toEqual([{ siteKey: 'b', siteName: 'Site b', id: 'b1', name: 'Vod b1', pic: 'q', remarks: '', year: '', type: '', time: 2_000 }]);
    const { catalog: none } = build([], undefined);
    expect(await none.history()).toEqual([]);
    expect(await none.keeps()).toEqual([]);
  });

  it('answers the search history and hot words', async () => {
    const { catalog, settings } = build();
    expect(await catalog.words()).toEqual({ history: [], hot: [] });
    await settings.set('keyword', JSON.stringify(['繁花']));
    await settings.set('hot', JSON.stringify(['三体']));
    expect(await catalog.words()).toEqual({ history: ['繁花'], hot: ['三体'] });
  });
});
