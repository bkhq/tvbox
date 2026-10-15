import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TVFocusGuideView,
} from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { type Bootstrap, BootstrapProvider, createBootstrap } from '../../../core/bootstrap';
import { parseVodConfig, type VodConfig, type VodConfigPrefs } from '../../../core/config';
import type { ServerLink } from '../../../core/serverLink';
import { registerProvider, resetProviderRegistry, type SiteProvider } from '../../../core/provider';
import { appSettings, createSettingsStore } from '../../../core/settings';
import { createConfigRepository, historyKey, MemoryStore } from '../../../core/storage';
import { normalizeResult, type Result } from '../../../core/types';
import { getHistoryRepository, getKeepRepository, setUserDataStore } from '../../../core/userData';
import { getMainNavAvailability, setMainNavAvailability } from '../../../navigation/mainNav';
import type { RootStackScreenProps } from '../../../navigation/types';
import { makeScaler, scaleFor } from '../../../ui/scale';
import { focus } from '../../../ui/tokens';
import HomeScreen, { HERO_FOCUS_DELAY } from '..';
import { HERO_ACTION_GAP } from '../Hero';
import { SITE_LIST_MAX_HEIGHT } from '../SitePicker';

// react-native resolves components lazily on first access; resolve the ones the
// screen renders while the file loads so no test pays that cost inside its timeout.
void [ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput, TVFocusGuideView];

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate, addListener: () => () => undefined };
jest.mock('../../../navigation/useAppNavigation', () => ({ useAppNavigation: () => mockNavigation }));

const URL = 'https://example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [
    { key: 'jar', name: 'Jar 站', type: 3, api: 'csp_Jar' },
    { key: 'cms', name: 'CMS 站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' },
    { key: 'xml', name: 'XML 站', type: 0, api: 'https://xml.example.com/api.php/provide/vod/at/xml' },
    { key: 'py', name: 'Py 站', type: 3, api: 'https://example.com/spider.py' },
  ],
});

const FILTERS = [{ key: 'year', name: '年份', value: [{ n: '全部', v: '' }] }];
const CLASSES = [
  { type_id: 'movie', type_name: '电影' },
  { type_id: 'tv', type_name: '剧集', filters: FILTERS },
  { type_id: 'anime', type_name: '动漫' },
];

function vods(siteKey: string) {
  return [
    {
      vod_id: `${siteKey}-1`,
      vod_name: `${siteKey} 影片 1`,
      vod_pic: `https://img.example.com/${siteKey}-1.jpg`,
      vod_remarks: '更新至1集',
      vod_score: '8.7',
      vod_year: '2026',
      vod_area: '大陆',
      type_name: '悬疑',
      vod_content: '<p>极夜来临前的最后七天</p>',
    },
    { vod_id: `${siteKey}-2`, vod_name: `${siteKey} 影片 2`, vod_pic: `https://img.example.com/${siteKey}-2.jpg` },
  ];
}

interface MockOptions {
  /** Sites whose home() rejects. */
  failing?: Set<string>;
  /** Sites without any videos. */
  noVideos?: Set<string>;
  classes?: object[];
  /** Home videos of every site instead of vods(). */
  videos?: object[];
}

function mockProviders(options: MockOptions = {}) {
  const home = jest.fn(async (site: string): Promise<Result> => {
    if (options.failing?.has(site)) throw new Error('home failed');
    return normalizeResult({ class: options.classes ?? CLASSES, list: [] });
  });
  const homeVideo = jest.fn(async (site: string): Promise<Result> =>
    normalizeResult({ list: options.noVideos?.has(site) ? [] : (options.videos ?? vods(site)) }),
  );
  const category = jest.fn(async (site: string, tid: string, page: string): Promise<Result> =>
    normalizeResult({
      page: Number(page),
      pagecount: 1,
      list: [{ vod_id: `${site}-${tid}-1`, vod_name: `${tid} 片 1`, vod_pic: '' }],
    }),
  );
  registerProvider({
    id: 'test',
    match: (site) => site.key === 'cms' || site.key === 'xml',
    create: (site) =>
      ({
        site,
        home: () => home(site.key),
        homeVideo: () => homeVideo(site.key),
        category: (tid: string, page: string) => category(site.key, tid, page),
      }) as unknown as SiteProvider,
  });
  return { home, homeVideo, category };
}

function texts(renderer: ReactTestRenderer | ReactTestInstance): string[] {
  const root = 'root' in renderer ? renderer.root : renderer;
  return root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

function byTestID(renderer: ReactTestRenderer, testID: string) {
  const [node] = renderer.root.findAll((item) => item.props.testID === testID && typeof item.type !== 'string');
  if (!node) throw new Error(`No element with testID ${testID}`);
  return node;
}

const has = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((item) => item.props.testID === testID).length > 0;

/** testIDs of the host views asking for the initial TV focus. */
function preferred(renderer: ReactTestRenderer): string[] {
  return renderer.root
    .findAll((item) => typeof item.type === 'string' && item.props.hasTVPreferredFocus === true)
    .map((item) => item.props.testID);
}

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

async function setup(
  options: {
    saved?: boolean;
    load?: (url: string, prefs?: VodConfigPrefs) => Promise<VodConfig>;
    link?: Partial<ServerLink>;
    section?: 'series' | 'movie';
    /** Do not wait for the config to load. */
    pending?: boolean;
  } = {},
) {
  const store = new MemoryStore();
  const configs = createConfigRepository(store, 'vod');
  const settings = createSettingsStore(store);
  if (options.saved) {
    await configs.add({ url: URL, name: '我的配置' });
    await configs.setActive(URL);
  }
  const loadConfig = jest.fn(
    options.load ?? ((url: string, _prefs?: VodConfigPrefs) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url))),
  );
  const link =
    options.link && ({ init: jest.fn(async () => undefined), onConfigError: jest.fn(), ...options.link } as ServerLink);
  const bootstrap = createBootstrap({
    configs,
    settings,
    loadConfig: (url, prefs) => loadConfig(url, prefs),
    createServerLink: link ? () => link : undefined,
  });
  const started = bootstrap.start();
  if (!options.pending) await started;
  const route = {
    params: options.section ? { section: options.section } : undefined,
  } as RootStackScreenProps<'Home'>['route'];
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <HomeScreen route={route} />
      </BootstrapProvider>,
    );
  });
  const cid = (await configs.getActive())?.id;
  return { renderer, bootstrap: bootstrap as Bootstrap, configs, loadConfig, link, cid };
}

describe('HomeScreen', () => {
  beforeEach(async () => {
    mockNavigate.mockClear();
    setUserDataStore(new MemoryStore());
    setMainNavAvailability({ series: true, movie: true });
    await appSettings.set('homeSiteKey', '');
  });
  afterEach(() => {
    resetProviderRegistry();
    setUserDataStore(undefined);
  });

  it('shows the top navigation and its actions', async () => {
    mockProviders();
    const { renderer } = await setup({ saved: true });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['首页', '剧集', '电影', '直播', '设置']));

    await act(async () => byTestID(renderer, 'top-nav-series').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Home', { section: 'series' });
    await act(async () => byTestID(renderer, 'top-nav-live').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Live');
    await act(async () => byTestID(renderer, 'top-nav-search').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Search');
    expect(['home-control', 'home-switch-site'].map((id) => byTestID(renderer, id).props.variant)).toEqual([
      'outline',
      'outline',
    ]);
    // 设置 is a tab now; the header has no settings button.
    expect(has(renderer, 'home-settings')).toBe(false);
    await act(async () => byTestID(renderer, 'top-nav-profile').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Settings');
    await act(async () => byTestID(renderer, 'home-control').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Control');

    // The removed old buttons stay gone.
    expect(texts(renderer)).not.toEqual(expect.arrayContaining(['历史记录']));
    expect(texts(renderer)).not.toContain('收藏');
    await act(async () => renderer.unmount());
  });

  it('shows the featured vod in the hero and omits missing data', async () => {
    mockProviders();
    const { renderer } = await setup({ saved: true });
    const hero = byTestID(renderer, 'home-hero');
    expect(texts(hero)).toEqual(
      expect.arrayContaining(['更新至1集', '悬疑', 'cms 影片 1', '2026', '大陆', '极夜来临前的最后七天']),
    );
    expect(texts(byTestID(renderer, 'home-hero-score'))).toEqual(['8.7']);
    expect(has(renderer, 'home-hero-bg')).toBe(true);
    expect(renderer.root.findByProps({ testID: 'home-hero-bg' }).props.blurRadius).toBe(30);
    expect(preferred(renderer)).toEqual(['home-hero-play']);
    const s = makeScaler(scaleFor(Dimensions.get('window').width));
    // The blurred image overshoots the clipped hero on its outer edges so its faded blur border stays hidden.
    const bg = renderer.root.findByProps({ testID: 'home-hero-bg' });
    expect(bg.props.style).toMatchObject({ top: -s(60), right: -s(60), bottom: -s(60) });
    expect(byTestID(renderer, 'home-hero-background').props.style.overflow).toBe('hidden');
    // Descender room: about 1.15x the font size.
    const titleStyle = byTestID(renderer, 'home-hero-title').props.style;
    expect(titleStyle.lineHeight).toBeGreaterThanOrEqual(titleStyle.fontSize * 1.14);
    // A focused 立即播放 (~250 wide) grows 4% per side plus its scaled ring and must not touch 加入片单.
    const ring = (focus.ringGap + focus.ringWidth) * focus.scale;
    expect(HERO_ACTION_GAP).toBeGreaterThan(((focus.scale - 1) / 2) * 300 + ring);
    expect(byTestID(renderer, 'home-hero-actions').props.style.gap).toBe(s(HERO_ACTION_GAP));

    // A focused card becomes the hero after the debounce; it has no remarks, type, score, year or content.
    await act(async () => byTestID(renderer, 'home-card-recommend-cms-2').props.onFocus());
    expect(texts(byTestID(renderer, 'home-hero'))).toContain('cms 影片 1');
    await wait(HERO_FOCUS_DELAY + 50);
    const next = byTestID(renderer, 'home-hero');
    expect(texts(next)).toContain('cms 影片 2');
    expect(texts(next)).not.toContain('悬疑');
    expect(texts(next)).not.toContain('2026');
    expect(has(renderer, 'home-hero-remarks')).toBe(false);
    expect(has(renderer, 'home-hero-score')).toBe(false);
    expect(has(renderer, 'home-hero-description')).toBe(false);

    await act(async () => byTestID(renderer, 'home-hero-detail').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Detail', {
      siteKey: 'cms',
      vodId: 'cms-2',
      vodName: 'cms 影片 2',
      vodPic: 'https://img.example.com/cms-2.jpg',
    });
    await act(async () => renderer.unmount());
  });

  it('hides a zero score in vod_remarks on the hero and the cards', async () => {
    mockProviders({
      videos: [
        { vod_id: 'z1', vod_name: '零分 1', vod_pic: '', vod_remarks: '评分：0', type_name: '剧情' },
        { vod_id: 'z2', vod_name: '零分 2', vod_pic: '', vod_remarks: '评分：0', vod_year: '2025' },
      ],
    });
    const { renderer } = await setup({ saved: true });
    expect(has(renderer, 'home-hero-remarks')).toBe(false);
    expect(texts(byTestID(renderer, 'home-hero'))).toContain('剧情');
    expect(texts(renderer)).not.toContain('评分：0');
    expect(byTestID(renderer, 'home-card-recommend-z1').props.badge).toBeUndefined();
    expect(byTestID(renderer, 'home-card-recommend-z2').props.badge).toBeUndefined();
    await act(async () => renderer.unmount());
  });

  it('plays from the detail page without history and resumes with it', async () => {
    mockProviders();
    const { renderer, cid } = await setup({ saved: true });
    await act(async () => byTestID(renderer, 'home-hero-play').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith(
      'Detail',
      expect.objectContaining({ siteKey: 'cms', vodId: 'cms-1' }),
    );

    await getHistoryRepository().upsert({
      key: historyKey('cms', 'cms-1'),
      cid: cid!,
      vodName: 'cms 影片 1',
      vodFlag: '线路一',
      vodRemarks: '第2集',
      episodeUrl: 'https://media.example.com/2.m3u8',
      position: 60000,
      duration: 120000,
    });
    await act(async () => byTestID(renderer, 'home-hero-play').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Player', {
      siteKey: 'cms',
      vodId: 'cms-1',
      flag: '线路一',
      episodeUrl: 'https://media.example.com/2.m3u8',
      position: 60000,
    });
    await act(async () => renderer.unmount());
  });

  it('toggles the hero vod in the keep list', async () => {
    mockProviders();
    const { renderer, cid } = await setup({ saved: true });
    const key = historyKey('cms', 'cms-1');
    expect(byTestID(renderer, 'home-hero-keep').props.title).toBe('加入片单');
    await act(async () => byTestID(renderer, 'home-hero-keep').props.onPress());
    expect(await getKeepRepository().list(cid!)).toEqual([
      expect.objectContaining({
        key,
        cid,
        siteName: 'CMS 站',
        vodName: 'cms 影片 1',
        vodPic: 'https://img.example.com/cms-1.jpg',
      }),
    ]);
    expect(byTestID(renderer, 'home-hero-keep').props.title).toBe('已在片单');
    await act(async () => byTestID(renderer, 'home-hero-keep').props.onPress());
    expect(await getKeepRepository().isKept(key, cid!)).toBe(false);
    expect(byTestID(renderer, 'home-hero-keep').props.title).toBe('加入片单');
    await act(async () => renderer.unmount());
  });

  it('shows the continue-watching row and opens its vods', async () => {
    mockProviders();
    const first = await setup({ saved: true });
    expect(has(first.renderer, 'home-continue')).toBe(false);
    await act(async () => first.renderer.unmount());

    await getHistoryRepository().upsert({
      key: historyKey('xml', 'x9'),
      cid: first.cid!,
      vodName: '午夜列车',
      vodPic: 'https://img.example.com/x9.jpg',
      vodRemarks: '第4集',
      position: 60000,
      duration: 120000,
    });
    const { renderer } = await setup({ saved: true });
    const row = byTestID(renderer, 'home-continue');
    expect(texts(row)).toEqual(expect.arrayContaining(['继续观看', '保存在本机', '午夜列车', '第4集 · 剩余 1 分钟']));
    const card = byTestID(renderer, `home-continue-${historyKey('xml', 'x9')}`);
    expect(card.props.progress).toBe(0.5);
    await act(async () => card.props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Detail', {
      siteKey: 'xml',
      vodId: 'x9',
      vodName: '午夜列车',
      vodPic: 'https://img.example.com/x9.jpg',
    });

    // History does not take over the hero: the card has no focus handler.
    expect(card.props.onFocus).toBeUndefined();
    expect(texts(byTestID(renderer, 'home-hero'))).not.toContain('午夜列车');

    // Long press: add to 片单, then delete the record.
    const key = historyKey('xml', 'x9');
    await act(async () => card.props.onLongPress());
    expect(texts(byTestID(renderer, 'home-continue-menu'))).toContain('午夜列车');
    await act(async () => byTestID(renderer, 'home-continue-keep').props.onPress());
    expect(await getKeepRepository().isKept(key, first.cid!)).toBe(true);
    expect(has(renderer, 'home-continue-menu')).toBe(false);
    await act(async () => card.props.onLongPress());
    await act(async () => byTestID(renderer, 'home-continue-delete').props.onPress());
    expect(await getHistoryRepository().get(first.cid!, key)).toBeUndefined();
    expect(has(renderer, 'home-continue')).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('clears the continue-watching row after confirmation', async () => {
    mockProviders();
    const first = await setup({ saved: true });
    await act(async () => first.renderer.unmount());
    for (const id of ['x1', 'x2']) {
      await getHistoryRepository().upsert({ key: historyKey('xml', id), cid: first.cid!, vodName: id, vodPic: '' });
    }
    const { renderer } = await setup({ saved: true });
    await act(async () => byTestID(renderer, 'home-continue-clear').props.onPress());
    await act(async () => byTestID(renderer, 'home-continue-menu-close').props.onPress());
    expect(await getHistoryRepository().list(first.cid!)).toHaveLength(2);
    await act(async () => byTestID(renderer, 'home-continue-clear').props.onPress());
    await act(async () => byTestID(renderer, 'home-continue-clear-confirm').props.onPress());
    expect(await getHistoryRepository().list(first.cid!)).toHaveLength(0);
    expect(has(renderer, 'home-continue')).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('shows recommendation cards and the remaining categories', async () => {
    mockProviders();
    const { renderer } = await setup({ saved: true });
    const card = byTestID(renderer, 'home-card-recommend-cms-1');
    expect(card.props.badge).toBe('更新至1集');
    expect(byTestID(renderer, 'home-card-recommend-cms-2').props.badge).toBeUndefined();
    // The recommendations are an untitled strip inside the hero, and focusing one makes it the hero.
    expect(
      byTestID(renderer, 'home-hero').findAll((node) => node.props.testID === 'home-row-recommend'),
    ).not.toHaveLength(0);
    expect(texts(renderer)).not.toContain('热门推荐');
    await act(async () => byTestID(renderer, 'home-card-recommend-cms-2').props.onFocus());
    await wait(HERO_FOCUS_DELAY + 50);
    expect(byTestID(renderer, 'home-hero-title').props.children).toBe('cms 影片 2');
    await act(async () => card.props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith(
      'Detail',
      expect.objectContaining({ siteKey: 'cms', vodId: 'cms-1' }),
    );

    // 电影 and 剧集 back the sections; only 动漫 is left as a chip.
    expect(has(renderer, 'home-class-movie')).toBe(false);
    expect(has(renderer, 'home-class-tv')).toBe(false);
    await act(async () => byTestID(renderer, 'home-class-anime').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Category', { siteKey: 'cms', typeId: 'anime', typeName: '动漫' });
    expect(preferred(renderer)).toEqual(['home-hero-play']);
    await act(async () => renderer.unmount());
  });

  it('updates the section tabs from the home site classes', async () => {
    mockProviders({ classes: [{ type_id: 'tv', type_name: '电视剧' }] });
    const { renderer } = await setup({ saved: true });
    expect(getMainNavAvailability()).toEqual({ series: true, movie: false });
    expect(has(renderer, 'top-nav-movie')).toBe(false);
    expect(has(renderer, 'top-nav-series')).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('shows a section as a paged grid with the filter button', async () => {
    const { category } = mockProviders();
    const { renderer } = await setup({ saved: true, section: 'series' });
    expect(category).toHaveBeenCalledWith('cms', 'tv', '1');
    expect(texts(renderer)).toEqual(expect.arrayContaining(['剧集', 'tv 片 1']));
    expect(byTestID(renderer, 'top-nav-series').props.active).toBe(true);
    expect(has(renderer, 'home-hero')).toBe(false);
    expect(preferred(renderer)).toEqual(['vod-card-cms-tv-1']);
    expect(getMainNavAvailability()).toEqual({ series: true, movie: true });

    expect(byTestID(renderer, 'home-section-title').props.variant).toBe('h1');
    expect(byTestID(renderer, 'home-section-filter').props.icon).toBe('filter');
    await act(async () => byTestID(renderer, 'home-section-filter').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Category', { siteKey: 'cms', typeId: 'tv', typeName: '剧集' });
    await act(async () => byTestID(renderer, 'vod-card-cms-tv-1').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith(
      'Detail',
      expect.objectContaining({ siteKey: 'cms', vodId: 'cms-tv-1' }),
    );
    await act(async () => renderer.unmount());

    const movie = await setup({ saved: true, section: 'movie' });
    expect(texts(movie.renderer)).toContain('电影');
    expect(has(movie.renderer, 'home-section-filter')).toBe(false);
    await act(async () => movie.renderer.unmount());
  });

  it('shows a note when the home site has no class for the section', async () => {
    mockProviders({ classes: [{ type_id: 'anime', type_name: '动漫' }] });
    const { renderer } = await setup({ saved: true, section: 'movie' });
    expect(texts(renderer)).toContain('当前站点没有此分类');
    expect(getMainNavAvailability()).toEqual({ series: false, movie: false });
    await act(async () => renderer.unmount());
  });

  it('switches the home site from the picker and reloads the content', async () => {
    const { home } = mockProviders();
    const { renderer } = await setup({ saved: true });
    expect(has(renderer, 'home-site-picker')).toBe(false);

    await act(async () => byTestID(renderer, 'home-switch-site').props.onPress());
    const picker = byTestID(renderer, 'home-site-picker');
    expect(texts(picker)).toEqual(
      expect.arrayContaining(['Jar 站', 'CMS 站', 'XML 站', 'Py 站', '不支持：JAR 爬虫', '不支持：Python 爬虫']),
    );
    expect(byTestID(renderer, 'home-site-cms').props.selected).toBe(true);
    expect(byTestID(renderer, 'home-site-xml').props.selected).toBe(false);
    expect(byTestID(renderer, 'home-site-jar').props.disabled).toBe(true);
    expect(preferred(renderer)).toEqual(['home-site-cms']);
    // The list is capped so a long site list scrolls instead of pushing 关闭 off screen.
    const s = makeScaler(scaleFor(Dimensions.get('window').width));
    expect(byTestID(renderer, 'home-site-list').props.style.maxHeight).toBe(s(SITE_LIST_MAX_HEIGHT));

    await act(async () => byTestID(renderer, 'home-site-xml').props.onPress());
    expect(appSettings.get('homeSiteKey')).toBe('xml');
    expect(has(renderer, 'home-site-picker')).toBe(false);
    expect(home).toHaveBeenLastCalledWith('xml');
    expect(texts(renderer)).toContain('xml 影片 1');
    expect(texts(renderer)).not.toContain('cms 影片 1');
    await act(async () => renderer.unmount());
  });

  it('closes the picker without changing the site', async () => {
    mockProviders();
    const { renderer } = await setup({ saved: true });
    await act(async () => byTestID(renderer, 'home-switch-site').props.onPress());
    // Hardware back (Android) / Menu (tvOS) arrives as Modal.onRequestClose.
    await act(async () => renderer.root.findByType(Modal).props.onRequestClose());
    expect(has(renderer, 'home-site-picker')).toBe(false);
    await act(async () => byTestID(renderer, 'home-switch-site').props.onPress());
    await act(async () => byTestID(renderer, 'home-site-picker-close').props.onPress());
    expect(has(renderer, 'home-site-picker')).toBe(false);
    expect(appSettings.get('homeSiteKey')).toBe('');
    expect(preferred(renderer)).toEqual(['home-hero-play']);
    await act(async () => renderer.unmount());
  });

  it('shows provider errors with a retry', async () => {
    const failing = new Set(['cms']);
    const { home } = mockProviders({ failing });
    const { renderer } = await setup({ saved: true });
    expect(texts(renderer)).toContain('加载失败：home failed');
    expect(preferred(renderer)).toEqual(['home-error-retry']);

    failing.clear();
    await act(async () => byTestID(renderer, 'home-error-retry').props.onPress());
    expect(home).toHaveBeenCalledTimes(2);
    expect(texts(renderer)).toContain('cms 影片 1');
    await act(async () => renderer.unmount());
  });

  it('shows a message when no site is supported', async () => {
    const onlyJar = JSON.stringify({ sites: [{ key: 'jar', name: 'Jar 站', type: 3, api: 'csp_Jar' }] });
    const { renderer } = await setup({ saved: true, load: (url) => Promise.resolve(parseVodConfig(onlyJar, url)) });
    expect(texts(renderer)).toContain('没有可用站点');
    await act(async () => byTestID(renderer, 'home-switch-site').props.onPress());
    expect(byTestID(renderer, 'home-site-jar').props.disabled).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('shows the config loading state under the top navigation', async () => {
    const { renderer } = await setup({
      saved: true,
      pending: true,
      load: () => new Promise<VodConfig>(() => undefined),
    });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['正在加载配置…', '首页']));
    expect(preferred(renderer)).toEqual([]);
    await act(async () => renderer.unmount());
  });

  it('adds a config when none is saved', async () => {
    mockProviders();
    const { renderer, configs, loadConfig } = await setup();
    expect(texts(renderer)).toEqual(expect.arrayContaining(['尚未添加配置', '添加配置']));
    expect(loadConfig).not.toHaveBeenCalled();
    expect(preferred(renderer)).toEqual(['home-config-input']);
    expect(has(renderer, 'home-switch-site')).toBe(false);
    await act(async () => byTestID(renderer, 'top-nav-profile').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Settings');

    await act(async () => byTestID(renderer, 'home-config-input').props.onChangeText(` ${URL} `));
    await act(async () => byTestID(renderer, 'home-config-add').props.onPress());

    expect((await configs.getActive())?.url).toBe(URL);
    expect(loadConfig).toHaveBeenCalledWith(URL, { home: undefined });
    expect(texts(renderer)).toContain('cms 影片 1');
    await act(async () => renderer.unmount());
  });

  it('shows the load error, reports it to the server link and retries', async () => {
    mockProviders();
    const failure = new Error('HTTP 404: ' + URL);
    let fail = true;
    const { renderer, loadConfig, link } = await setup({
      saved: true,
      load: (url) => (fail ? Promise.reject(failure) : Promise.resolve(parseVodConfig(CONFIG_TEXT, url))),
      link: {},
    });
    expect(link?.init).toHaveBeenCalled();
    expect(link?.onConfigError).toHaveBeenCalledWith(URL, failure);
    expect(texts(renderer)).toContain(`配置加载失败：${failure.message}`);
    expect(preferred(renderer)).toEqual(['home-reload']);
    await act(async () => byTestID(renderer, 'top-nav-live').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Live');

    fail = false;
    await act(async () => byTestID(renderer, 'home-reload').props.onPress());
    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(texts(renderer)).toContain('cms 影片 1');
    await act(async () => renderer.unmount());
  });

  it('shows a config the server link loads', async () => {
    let linkLoad: ((url: string) => Promise<unknown>) | undefined;
    const store = new MemoryStore();
    const configs = createConfigRepository(store, 'vod');
    const bootstrap = createBootstrap({
      configs,
      settings: createSettingsStore(store),
      loadConfig: (url) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url)),
      createServerLink: (load) => {
        linkLoad = load;
        return { init: async () => undefined, onConfigError: jest.fn() } as unknown as ServerLink;
      },
    });
    await bootstrap.start();
    expect(bootstrap.getSnapshot().status).toBe('empty');

    // What the link does when a subscription is approved.
    await configs.add({ url: URL });
    await configs.setActive(URL);
    await linkLoad?.(URL);
    expect(bootstrap.getSnapshot()).toMatchObject({ status: 'ready', entry: { url: URL } });
  });
});
