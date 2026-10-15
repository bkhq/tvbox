import { createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { parseSite } from '../../../core/config/vodConfig';
import { registerProvider, resetProviderRegistry, type SiteProvider } from '../../../core/provider';
import { normalizeResult, normalizeVod, type Result, type Vod } from '../../../core/types';
import {
  createSiteHomeContent,
  type HomeContent,
  type HomeContentProvider,
  type HomeState,
  pickFeatured,
  useHomeContent,
} from '../homeContent';

const SITE = parseSite({ key: 'cms', name: 'CMS 站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' });

const vod = (id: string, pic = `https://img.example.com/${id}.jpg`): Vod =>
  normalizeVod({ vod_id: id, vod_name: `片 ${id}`, vod_pic: pic });

function mockSite(home: () => Promise<Result>, homeVideo: () => Promise<Result>) {
  registerProvider({
    id: 'test',
    match: (site) => site.key === 'cms',
    create: (site) => ({ site, home, homeVideo }) as unknown as SiteProvider,
  });
}

afterEach(() => resetProviderRegistry());

describe('pickFeatured', () => {
  it('takes the first five vods with a picture', () => {
    const videos = [vod('1', ''), vod('2'), vod('3'), vod('4', ''), vod('5'), vod('6'), vod('7'), vod('8')];
    expect(pickFeatured(videos).map((item) => item.vod_id)).toEqual(['2', '3', '5', '6', '7']);
  });

  it('falls back to the first five when none has a picture', () => {
    const videos = ['1', '2', '3', '4', '5', '6'].map((id) => vod(id, ''));
    expect(pickFeatured(videos).map((item) => item.vod_id)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('createSiteHomeContent', () => {
  const classes = [{ type_id: '1', type_name: '电影' }];

  it('prefers the homeVideo list and builds featured and one recommend row', async () => {
    mockSite(
      async () => normalizeResult({ class: classes, list: [{ vod_id: 'h1', vod_pic: 'p' }] }),
      async () => normalizeResult({ list: [{ vod_id: 'v1', vod_pic: 'p' }, { vod_id: 'v2' }] }),
    );
    const provider = createSiteHomeContent(SITE);
    expect(provider.key).toBe('cms');
    const content = await provider.load();
    expect(content.classes.map((item) => item.type_name)).toEqual(['电影']);
    expect(content.featured.map((item) => item.vod_id)).toEqual(['v1']);
    expect(content.featuredSiteKey).toBe('cms');
    expect(content.rows).toHaveLength(1);
    expect(content.rows[0]).toMatchObject({ key: 'recommend', title: '热门推荐', siteKey: 'cms' });
    expect(content.rows[0]!.items.map((item) => item.vod_id)).toEqual(['v1', 'v2']);
  });

  it('falls back to home.list when homeVideo fails or is empty', async () => {
    mockSite(
      async () => normalizeResult({ class: classes, list: [{ vod_id: 'h1' }] }),
      async () => {
        throw new Error('no home video');
      },
    );
    const failed = await createSiteHomeContent(SITE).load();
    expect(failed.rows[0]!.items.map((item) => item.vod_id)).toEqual(['h1']);

    resetProviderRegistry(); // drops the cached provider instance of the site
    mockSite(
      async () => normalizeResult({ class: classes, list: [{ vod_id: 'h2' }] }),
      async () => normalizeResult({ list: [] }),
    );
    const empty = await createSiteHomeContent(SITE).load();
    expect(empty.rows[0]!.items.map((item) => item.vod_id)).toEqual(['h2']);
  });

  it('has no rows when the site has no videos', async () => {
    mockSite(
      async () => normalizeResult({ class: classes }),
      async () => normalizeResult({}),
    );
    const content = await createSiteHomeContent(SITE).load();
    expect(content.rows).toEqual([]);
    expect(content.featured).toEqual([]);
  });
});

describe('createSiteHomeContent for the recommendation home', () => {
  const HOME = parseSite({ key: 'bk_home', name: '推荐', type: 1, api: 'https://worker.example/s/t/media/home' });
  const charts = [
    { type_id: 'hot', type_name: '实时热门' },
    { type_id: 'tv', type_name: '热门剧集' },
    { type_id: 'down', type_name: '坏榜单' },
    { type_id: 'none', type_name: '空榜单' },
  ];

  it('shows the home list and each chart as rows, leaving out failed and empty ones', async () => {
    const category = jest.fn(async (tid: string) => {
      if (tid === 'down') throw new Error('offline');
      return normalizeResult({ list: tid === 'tv' ? [{ vod_id: 'msearch:db:2', vod_pic: 'p' }] : [] });
    });
    registerProvider({
      id: 'test',
      match: (site) => site.key === 'bk_home',
      create: (site) =>
        ({
          site,
          home: async () => normalizeResult({ class: charts, list: [{ vod_id: 'msearch:db:1', vod_pic: 'p' }] }),
          category,
        }) as unknown as SiteProvider,
    });
    const content = await createSiteHomeContent(HOME).load();
    expect(content.rows.map((row) => [row.key, row.title, row.items.map((item) => item.vod_id)])).toEqual([
      ['hot', '实时热门', ['msearch:db:1']],
      ['tv', '热门剧集', ['msearch:db:2']],
    ]);
    expect(content.featured.map((item) => item.vod_id)).toEqual(['msearch:db:1']);
    expect(category.mock.calls.map(([tid]) => tid)).toEqual(['tv', 'down', 'none']);
  });
});

const CONTENT: HomeContent = { classes: [], featured: [], featuredSiteKey: 'cms', rows: [] };

function deferred() {
  let resolve!: (value: HomeContent) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<HomeContent>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderHome(provider: HomeContentProvider | undefined) {
  const result: { state?: HomeState; retry?: () => void } = {};
  function Probe({ value }: { value: HomeContentProvider | undefined }) {
    [result.state, result.retry] = useHomeContent(value);
    return null;
  }
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(createElement(Probe, { value: provider }));
  });
  const update = (next: HomeContentProvider | undefined) =>
    act(async () => renderer.update(createElement(Probe, { value: next })));
  return { result, update };
}

describe('useHomeContent', () => {
  it('stays loading without a provider', async () => {
    const { result } = await renderHome(undefined);
    expect(result.state).toEqual({ status: 'loading' });
  });

  it('loads, reports ready, and retries after an error', async () => {
    const load = jest
      .fn<Promise<HomeContent>, [AbortSignal?]>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce(CONTENT);
    const { result } = await renderHome({ key: 'cms', load });
    expect(result.state).toEqual({ status: 'error', message: '加载失败：boom' });

    await act(async () => result.retry!());
    expect(load).toHaveBeenCalledTimes(2);
    expect(result.state).toEqual({ status: 'ready', content: CONTENT });
  });

  it('maps an unsupported site to 站点不支持', async () => {
    registerProvider({ id: 'test', match: () => false, create: () => ({}) as SiteProvider });
    const unsupported = parseSite({ key: 'jar', name: 'JAR 站', type: 3, api: 'csp_Demo' });
    const { result } = await renderHome(createSiteHomeContent(unsupported));
    expect(result.state).toEqual({ status: 'error', message: '站点不支持：JAR 站' });
  });

  it('ignores the result of a replaced provider', async () => {
    const first = deferred();
    const second = deferred();
    const a: HomeContentProvider = { key: 'a', load: () => first.promise };
    const b: HomeContentProvider = { key: 'b', load: () => second.promise };
    const { result, update } = await renderHome(a);
    await update(b);
    expect(result.state).toEqual({ status: 'loading' });

    await act(async () => first.resolve({ ...CONTENT, featuredSiteKey: 'a' }));
    expect(result.state).toEqual({ status: 'loading' });

    await act(async () => second.resolve({ ...CONTENT, featuredSiteKey: 'b' }));
    expect(result.state).toEqual({ status: 'ready', content: { ...CONTENT, featuredSiteKey: 'b' } });
  });

  it('aborts the signal of a replaced provider', async () => {
    let signal: AbortSignal | undefined;
    const a: HomeContentProvider = {
      key: 'a',
      load: (s) => {
        signal = s;
        return new Promise(() => undefined);
      },
    };
    const { update } = await renderHome(a);
    expect(signal?.aborted).toBe(false);
    await update({ key: 'b', load: async () => CONTENT });
    expect(signal?.aborted).toBe(true);
  });
});
