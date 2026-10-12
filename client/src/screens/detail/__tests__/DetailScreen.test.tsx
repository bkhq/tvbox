import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TVFocusGuideView,
} from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { BootstrapProvider, createBootstrap } from '../../../core/bootstrap';
import { parseVodConfig } from '../../../core/config';
import { clearProviders, registerProvider, resetProviderRegistry, type SiteProvider } from '../../../core/provider';
import { createSettingsStore } from '../../../core/settings';
import { createConfigRepository, historyKey, MemoryStore, TIME_UNSET } from '../../../core/storage';
import { normalizeResult, type Result } from '../../../core/types';
import { getHistoryRepository, getKeepRepository, setUserDataStore } from '../../../core/userData';
import type { RootStackScreenProps } from '../../../navigation/types';
import DetailScreen from '..';

// react-native resolves components lazily on first access; resolve the ones the
// screen renders while the file loads so no test pays that cost inside its timeout.
void [ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput, TVFocusGuideView];

const mockNavigate = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({
    navigate: mockNavigate,
    addListener: () => () => undefined,
  }),
}));

const URL = 'https://example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [
    {
      key: 'cms',
      name: 'CMS 站',
      type: 1,
      api: 'https://cms.example.com/api.php/provide/vod',
    },
    { key: 'jar', name: 'Jar 站', type: 3, api: 'csp_Jar' },
  ],
});
const KEY = historyKey('cms', 'v1');

const VOD = {
  vod_id: 'v1',
  vod_name: '测试影片',
  vod_pic: 'https://img.example.com/v1.jpg',
  type_name: '剧情',
  vod_year: '2024',
  vod_area: '大陆',
  vod_remarks: '更新至3集',
  vod_director: '导演甲',
  vod_actor: '演员乙',
  vod_content: '简介内容',
  vod_play_from: 'a$$$b',
  vod_play_url: '第1集$a1#第2集$a2$$$第1集$b1#第2集$b2#第3集$b3',
};

function mockProvider(list: object[] = [VOD]) {
  const detail = jest.fn(async (): Promise<Result> => normalizeResult({ list }));
  registerProvider({
    id: 'test',
    match: (site) => site.key === 'cms',
    create: (site) => ({ site, detail }) as unknown as SiteProvider,
  });
  return detail;
}

async function render(params: RootStackScreenProps<'Detail'>['route']['params'], options: { withCid?: boolean } = {}) {
  const store = new MemoryStore();
  const configs = createConfigRepository(store, 'vod');
  await configs.add({ url: URL });
  await configs.setActive(URL);
  const loaded = createBootstrap({
    configs,
    settings: createSettingsStore(store),
    loadConfig: (url) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url)),
  });
  await loaded.start();
  // A loaded config without a saved entry: no cid for history and keeps.
  const noCid = { ...loaded.getSnapshot(), entry: undefined };
  const bootstrap = options.withCid === false ? { ...loaded, getSnapshot: () => noCid } : loaded;
  const props = {
    route: { key: 'Detail', name: 'Detail', params },
  } as unknown as RootStackScreenProps<'Detail'>;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <DetailScreen {...props} />
      </BootstrapProvider>,
    );
  });
  const cid = (await configs.getActive())?.id;
  return { renderer, cid };
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

function byTestId(renderer: ReactTestRenderer, testID: string) {
  // The outermost match carries the props given by the screen.
  return renderer.root.findAll((node) => node.props.testID === testID)[0]!;
}

const has = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => node.props.testID === testID).length > 0;

const episodeTitles = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type !== 'string' && /^detail-episode-\d+$/.test(String(node.props.testID ?? '')))
    .filter((node) => node.props.title !== undefined)
    .map((node) => node.props.title as string);

describe('DetailScreen', () => {
  // VirtualizedList batches cell updates on a 50 ms timer; fake timers keep it from
  // firing outside act() on a slow host, and unmounting clears it.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    mockNavigate.mockClear();
    setUserDataStore(new MemoryStore());
  });
  afterEach(() => {
    resetProviderRegistry();
    setUserDataStore(undefined);
  });

  it('renders info, flags and the episodes of the first flag', async () => {
    const detail = mockProvider();
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(detail).toHaveBeenCalledWith(['v1']);
    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        '详情',
        '测试影片',
        '剧情 / 2024 / 大陆 / 更新至3集',
        '导演：导演甲',
        '演员：演员乙',
        '简介内容',
      ]),
    );
    expect(byTestId(renderer, 'detail-flag-0').props).toMatchObject({
      title: 'a',
      selected: true,
    });
    expect(byTestId(renderer, 'detail-flag-1').props).toMatchObject({
      title: 'b',
      selected: false,
    });
    expect(episodeTitles(renderer)).toEqual(['第1集', '第2集']);
    expect(byTestId(renderer, 'detail-play').props.hasTVPreferredFocus).toBe(true);
    expect(has(renderer, 'detail-resume')).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('renders an HTML description as plain text', async () => {
    mockProvider([{ ...VOD, vod_content: '<p>&nbsp;&nbsp;第一段&ldquo;引用&rdquo;</p><p>\u3000第二段<br/>第三行 &amp; &#20013;</p>' }]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(texts(renderer)).toContain('第一段“引用”\n第二段\n第三行 & 中');
    expect(texts(renderer).some((text) => /[<>]|&nbsp;/.test(text))).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('switches episodes with the flag and reverses them', async () => {
    mockProvider();
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    await act(async () => byTestId(renderer, 'detail-flag-1').props.onPress());
    expect(byTestId(renderer, 'detail-flag-1').props.selected).toBe(true);
    expect(episodeTitles(renderer)).toEqual(['第1集', '第2集', '第3集']);
    await act(async () => byTestId(renderer, 'detail-sort').props.onPress());
    expect(episodeTitles(renderer)).toEqual(['第3集', '第2集', '第1集']);
    await act(async () => renderer.unmount());
  });

  it('adds and removes a keep', async () => {
    mockProvider();
    const { renderer, cid } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(byTestId(renderer, 'detail-collect').props.title).toBe('收藏');
    await act(async () => byTestId(renderer, 'detail-collect').props.onPress());
    expect(byTestId(renderer, 'detail-collect').props.title).toBe('已收藏');
    expect(await getKeepRepository().list(cid!)).toEqual([
      expect.objectContaining({
        key: KEY,
        cid,
        siteName: 'CMS 站',
        vodName: '测试影片',
        vodPic: VOD.vod_pic,
        type: 0,
      }),
    ]);
    await act(async () => byTestId(renderer, 'detail-collect').props.onPress());
    expect(byTestId(renderer, 'detail-collect').props.title).toBe('收藏');
    expect(await getKeepRepository().isKept(KEY, cid!)).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('restores flag, episode and sort from history and resumes with its position', async () => {
    mockProvider();
    await getHistoryRepository().upsert({
      key: KEY,
      cid: 1,
      vodFlag: 'b',
      episodeUrl: 'b2',
      revSort: true,
      position: 5000,
    });
    const { renderer, cid } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(cid).toBe(1);
    expect(byTestId(renderer, 'detail-flag-1').props.selected).toBe(true);
    expect(episodeTitles(renderer)).toEqual(['第3集', '第2集', '第1集']);
    expect(byTestId(renderer, 'detail-episode-1').props.selected).toBe(true);
    expect(byTestId(renderer, 'detail-sort').props.selected).toBe(true);
    const resume = byTestId(renderer, 'detail-resume');
    expect(resume.props).toMatchObject({
      title: '继续播放 第2集',
      hasTVPreferredFocus: true,
    });
    expect(byTestId(renderer, 'detail-collect').props.hasTVPreferredFocus).toBe(false);

    await act(async () => resume.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Player', {
      siteKey: 'cms',
      vodId: 'v1',
      flag: 'b',
      episodeUrl: 'b2',
      position: 5000,
    });
    await act(async () => renderer.unmount());
  });

  it('writes history and opens the player when an episode is pressed', async () => {
    mockProvider();
    await getHistoryRepository().upsert({
      key: KEY,
      cid: 1,
      vodFlag: 'a',
      episodeUrl: 'a1',
      position: 5000,
    });
    const { renderer, cid } = await render({ siteKey: 'cms', vodId: 'v1' });
    await act(async () => byTestId(renderer, 'detail-episode-1').props.onPress());
    expect(await getHistoryRepository().get(cid!, KEY)).toMatchObject({
      vodName: '测试影片',
      vodPic: VOD.vod_pic,
      vodFlag: 'a',
      vodRemarks: '第2集',
      episodeUrl: 'a2',
      revSort: false,
      position: TIME_UNSET,
    });
    expect(mockNavigate).toHaveBeenCalledWith('Player', {
      siteKey: 'cms',
      vodId: 'v1',
      flag: 'a',
      episodeUrl: 'a2',
    });
    expect(byTestId(renderer, 'detail-episode-1').props.selected).toBe(true);
    expect(byTestId(renderer, 'detail-resume').props.title).toBe('继续播放 第2集');
    await act(async () => renderer.unmount());
  });

  it('shows the params while loading and retries after a failure', async () => {
    let fail = true;
    const detail = jest.fn(async (): Promise<Result> => {
      if (fail) throw new Error('boom');
      return normalizeResult({ list: [VOD] });
    });
    registerProvider({
      id: 'test',
      match: (site) => site.key === 'cms',
      create: (site) => ({ site, detail }) as unknown as SiteProvider,
    });
    const { renderer } = await render({
      siteKey: 'cms',
      vodId: 'v1',
      vodName: '参数名称',
    });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['详情', '参数名称', '加载失败：boom']));
    fail = false;
    await act(async () => byTestId(renderer, 'detail-error-retry').props.onPress());
    expect(texts(renderer)).toContain('测试影片');
    await act(async () => renderer.unmount());
  });

  it('reports an empty detail list', async () => {
    mockProvider([]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['详情', '未找到影片', '重试']));
    await act(async () => renderer.unmount());
  });

  it('shows an error for unknown and unsupported sites', async () => {
    clearProviders();
    for (const siteKey of ['missing', 'jar']) {
      const { renderer } = await render({ siteKey, vodId: 'v1' });
      expect(texts(renderer)).toEqual(expect.arrayContaining(['详情', '站点不可用']));
      await act(async () => renderer.unmount());
    }
  });

  it('disables collect and skips history without a cid', async () => {
    mockProvider();
    const { renderer, cid } = await render({ siteKey: 'cms', vodId: 'v1' }, { withCid: false });
    expect(byTestId(renderer, 'detail-collect').props.disabled).toBe(true);
    await act(async () => byTestId(renderer, 'detail-episode-0').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Player', {
      siteKey: 'cms',
      vodId: 'v1',
      flag: 'a',
      episodeUrl: 'a1',
    });
    expect(await getHistoryRepository().list(cid!)).toEqual([]);
    await act(async () => renderer.unmount());
  });
});
