import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
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
import { card, focus, space, type } from '../../../ui';
import DetailScreen, { DETAIL_ACTION_GAP, EPISODES_TOP } from '..';
import { FLAG_PICKER_GAP } from '../FlagPicker';

// react-native resolves components lazily on first access; resolve the ones the
// screen renders while the file loads so no test pays that cost inside its timeout.
void [ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput, TVFocusGuideView];

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockFocusListeners = new Set<() => void>();
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    addListener: (event: string, listener: () => void) => {
      if (event !== 'focus') return () => undefined;
      mockFocusListeners.add(listener);
      return () => mockFocusListeners.delete(listener);
    },
  }),
}));

const URL = 'https://example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [
    { key: 'cms', name: 'CMS 站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' },
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

function mockProvider(list: object[] = [VOD], similar: object[] = []) {
  const detail = jest.fn(async (): Promise<Result> => normalizeResult({ list }));
  const search = jest.fn(async (): Promise<Result> => normalizeResult({ list: similar }));
  registerProvider({
    id: 'test',
    match: (site) => site.key === 'cms',
    create: (site) => ({ site, detail, search }) as unknown as SiteProvider,
  });
  return Object.assign(detail, { search });
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
  const props = { route: { key: 'Detail', name: 'Detail', params } } as unknown as RootStackScreenProps<'Detail'>;
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

/** flexGrow of the page ScrollView content: status pages fill the viewport so the status view centres. */
function contentGrow(renderer: ReactTestRenderer, testID: string) {
  const scroll = renderer.root.findAllByType(ScrollView).find((node) => node.props.testID === testID)!;
  return StyleSheet.flatten(scroll.props.contentContainerStyle).flexGrow;
}

const has = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => node.props.testID === testID).length > 0;

const preferred = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type !== 'string' && node.props.hasTVPreferredFocus === true && node.props.testID)
    .map((node) => node.props.testID as string)
    .filter((id, index, ids) => ids.indexOf(id) === index);

const episodeTitles = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type !== 'string' && /^detail-episode-\d+$/.test(String(node.props.testID ?? '')))
    .filter((node) => node.props.title !== undefined)
    .map((node) => node.props.title as string);

/** Text of the flag picker; the chevron must follow it. */
function flagPickerName(renderer: ReactTestRenderer): string {
  const ids = byTestId(renderer, 'detail-flag-picker')
    .findAll((node) => typeof node.type !== 'string' && typeof node.props.testID === 'string')
    .map((node) => node.props.testID as string)
    .filter((id, index, list) => list.indexOf(id) === index);
  expect(ids.slice(-2)).toEqual(['detail-flag-picker-name', 'detail-flag-picker-chevron']);
  return byTestId(renderer, 'detail-flag-picker-name').props.children as string;
}

const flat = (renderer: ReactTestRenderer, testID: string) =>
  StyleSheet.flatten(byTestId(renderer, testID).props.style);

const guideOf = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAllByType(TVFocusGuideView).find((node) => node.props.testID === testID)!;
const tabBar = (renderer: ReactTestRenderer) => guideOf(renderer, 'detail-tab-bar');

/** The rendered title and the screen's scale factor, derived from it. */
function title(renderer: ReactTestRenderer, name: string) {
  const node = renderer.root.findAllByType(Text).find((item) => item.props.children === name)!;
  return StyleSheet.flatten(node.props.style);
}

describe('DetailScreen', () => {
  // VirtualizedList batches cell updates on a 50 ms timer; fake timers keep it from
  // firing outside act() on a slow host, and unmounting clears it.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    mockFocusListeners.clear();
    setUserDataStore(new MemoryStore());
  });
  afterEach(() => {
    resetProviderRegistry();
    setUserDataStore(undefined);
  });

  it('renders info, the flag picker and the episodes of the first flag', async () => {
    const detail = mockProvider();
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(detail).toHaveBeenCalledWith(['v1']);
    expect(texts(renderer)).toEqual(
      expect.arrayContaining([
        '更新至3集',
        '剧情 · 大陆 · 2024',
        '测试影片',
        '导演',
        '导演甲',
        '主演',
        '演员乙',
        '简介内容',
      ]),
    );
    expect(has(renderer, 'detail-backdrop')).toBe(true);
    expect(has(renderer, 'detail-score')).toBe(false);
    expect(flagPickerName(renderer)).toBe('a');
    expect(episodeTitles(renderer)).toEqual(['第1集', '第2集']);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['1', '2']));
    expect(byTestId(renderer, 'detail-play').props.title).toBe('立即播放');
    expect(preferred(renderer)).toEqual(['detail-play']);
    expect(has(renderer, 'detail-resume')).toBe(false);
    expect(has(renderer, 'detail-tab-cast')).toBe(true);
    await act(async () => byTestId(renderer, 'detail-back').props.onPress());
    expect(mockGoBack).toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('omits metadata the source does not provide and shows a score when present', async () => {
    mockProvider([
      {
        vod_id: 'v1',
        vod_name: '一个名字很长很长的测试影片',
        vod_score: 8.7,
        vod_play_from: 'a',
        vod_play_url: '第1集$a1',
      },
    ]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(has(renderer, 'detail-remarks')).toBe(false);
    expect(has(renderer, 'detail-backdrop')).toBe(false);
    expect(has(renderer, 'detail-tab-cast')).toBe(false);
    expect(texts(renderer).some((text) => /导演|主演|·/.test(text))).toBe(false);
    expect(has(renderer, 'detail-score')).toBe(true);
    expect(texts(renderer)).toContain('8.7');
    // One flag: no picker, only its name.
    expect(has(renderer, 'detail-flag-picker')).toBe(false);
    expect(byTestId(renderer, 'detail-flag-name').props.children).toBe('a');
    await act(async () => renderer.unmount());
  });

  it('omits the score without one', async () => {
    mockProvider([{ ...VOD, vod_remarks: '', type_name: '', vod_area: '', vod_year: '' }]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(has(renderer, 'detail-score')).toBe(false);
    expect(has(renderer, 'detail-remarks')).toBe(false);
    expect(texts(renderer)).not.toContain('');
    await act(async () => renderer.unmount());
  });

  it('hides a zero score in vod_remarks', async () => {
    mockProvider([{ ...VOD, vod_remarks: '评分：0' }]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(has(renderer, 'detail-remarks')).toBe(false);
    expect(texts(renderer)).not.toContain('评分：0');
    expect(texts(renderer).some((text) => text.includes('剧情'))).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('renders an HTML description as plain text', async () => {
    mockProvider([
      { ...VOD, vod_content: '<p>&nbsp;&nbsp;第一段&ldquo;引用&rdquo;</p><p>　第二段<br/>第三行 &amp; &#20013;</p>' },
    ]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(texts(renderer)).toContain('第一段“引用”\n第二段\n第三行 & 中');
    expect(texts(renderer).some((text) => /[<>]|&nbsp;/.test(text))).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('switches the flag in the picker and reverses the episodes', async () => {
    mockProvider();
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(has(renderer, 'detail-flag-1')).toBe(false);
    await act(async () => byTestId(renderer, 'detail-flag-picker').props.onPress());
    expect(byTestId(renderer, 'detail-flag-0').props).toMatchObject({ label: 'a', selected: true });
    expect(byTestId(renderer, 'detail-flag-1').props).toMatchObject({ label: 'b', selected: false });
    await act(async () => byTestId(renderer, 'detail-flag-1').props.onPress());
    expect(has(renderer, 'detail-flag-1')).toBe(false);
    expect(flagPickerName(renderer)).toBe('b');
    expect(episodeTitles(renderer)).toEqual(['第1集', '第2集', '第3集']);
    await act(async () => byTestId(renderer, 'detail-sort').props.onPress());
    expect(byTestId(renderer, 'detail-sort').props.selected).toBe(true);
    expect(episodeTitles(renderer)).toEqual(['第3集', '第2集', '第1集']);
    // The number badges keep the original order.
    const badges = renderer.root
      .findAllByType(Text)
      .map((node) => node.props.children)
      .filter((value) => /^\d$/.test(String(value)));
    expect(badges).toEqual(['3', '2', '1']);
    await act(async () => renderer.unmount());
  });

  it('persists the sort order only for an existing record', async () => {
    mockProvider();
    const { renderer, cid } = await render({ siteKey: 'cms', vodId: 'v1' });
    await act(async () => byTestId(renderer, 'detail-sort').props.onPress());
    expect(await getHistoryRepository().get(cid!, KEY)).toBeUndefined();
    await act(async () => renderer.unmount());

    await getHistoryRepository().upsert({ key: KEY, cid: cid!, vodFlag: 'a', episodeUrl: 'a1' });
    const again = await render({ siteKey: 'cms', vodId: 'v1' });
    await act(async () => byTestId(again.renderer, 'detail-sort').props.onPress());
    expect(await getHistoryRepository().get(cid!, KEY)).toMatchObject({ revSort: true });
    await act(async () => again.renderer.unmount());
  });

  it('adds and removes a keep', async () => {
    mockProvider();
    const { renderer, cid } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(byTestId(renderer, 'detail-collect').props).toMatchObject({ title: '片单', icon: 'plus' });
    await act(async () => byTestId(renderer, 'detail-collect').props.onPress());
    expect(byTestId(renderer, 'detail-collect').props).toMatchObject({ title: '已在片单', icon: 'check' });
    expect(await getKeepRepository().list(cid!)).toEqual([
      expect.objectContaining({ key: KEY, cid, siteName: 'CMS 站', vodName: '测试影片', vodPic: VOD.vod_pic, type: 0 }),
    ]);
    await act(async () => byTestId(renderer, 'detail-collect').props.onPress());
    expect(byTestId(renderer, 'detail-collect').props.title).toBe('片单');
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
      position: 30_000,
      duration: 120_000,
    });
    const { renderer, cid } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(cid).toBe(1);
    expect(flagPickerName(renderer)).toBe('b');
    expect(episodeTitles(renderer)).toEqual(['第3集', '第2集', '第1集']);
    expect(has(renderer, 'detail-episode-1-current')).toBe(true);
    expect(has(renderer, 'detail-episode-0-current')).toBe(false);
    expect(byTestId(renderer, 'detail-episode-1').props.progress).toBe(0.25);
    expect(byTestId(renderer, 'detail-episode-0').props.progress).toBeUndefined();
    expect(byTestId(renderer, 'detail-sort').props.selected).toBe(true);
    const resume = byTestId(renderer, 'detail-resume');
    expect(resume.props).toMatchObject({ title: '继续播放 · 第2集', hasTVPreferredFocus: true });
    expect(preferred(renderer)).toEqual(['detail-resume']);

    await act(async () => resume.props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Player', {
      siteKey: 'cms',
      vodId: 'v1',
      flag: 'b',
      episodeUrl: 'b2',
      position: 30_000,
    });
    await act(async () => renderer.unmount());
  });

  it('plays the first episode of the current flag with 立即播放', async () => {
    mockProvider();
    const { renderer, cid } = await render({ siteKey: 'cms', vodId: 'v1' });
    await act(async () => byTestId(renderer, 'detail-sort').props.onPress());
    await act(async () => byTestId(renderer, 'detail-play').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Player', { siteKey: 'cms', vodId: 'v1', flag: 'a', episodeUrl: 'a1' });
    expect(await getHistoryRepository().get(cid!, KEY)).toMatchObject({
      vodFlag: 'a',
      episodeUrl: 'a1',
      revSort: true,
    });
    await act(async () => renderer.unmount());
  });

  it('writes history and opens the player when an episode is pressed', async () => {
    mockProvider();
    await getHistoryRepository().upsert({ key: KEY, cid: 1, vodFlag: 'a', episodeUrl: 'a1', position: 5000 });
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
    expect(mockNavigate).toHaveBeenCalledWith('Player', { siteKey: 'cms', vodId: 'v1', flag: 'a', episodeUrl: 'a2' });
    expect(has(renderer, 'detail-episode-1-current')).toBe(true);
    expect(byTestId(renderer, 'detail-resume').props.title).toBe('继续播放 · 第2集');
    await act(async () => renderer.unmount());
  });

  it('picks up the player progress on focus without remounting or reloading the body', async () => {
    const detail = mockProvider();
    await getHistoryRepository().upsert({ key: KEY, cid: 1, vodFlag: 'a', episodeUrl: 'a1', position: 5000 });
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    const body = byTestId(renderer, 'detail-body');
    const episodes = byTestId(renderer, 'detail-episodes');
    // The player moved on to the third episode of the other flag before BACK.
    await getHistoryRepository().upsert({
      key: KEY,
      cid: 1,
      vodFlag: 'b',
      episodeUrl: 'b3',
      position: 60_000,
      duration: 120_000,
    });
    expect(mockFocusListeners.size).toBe(1);
    await act(async () => mockFocusListeners.forEach((listener) => listener()));
    expect(byTestId(renderer, 'detail-body')).toBe(body);
    expect(byTestId(renderer, 'detail-episodes')).toBe(episodes);
    expect(detail).toHaveBeenCalledTimes(1);
    expect(flagPickerName(renderer)).toBe('b');
    expect(episodeTitles(renderer)).toEqual(['第1集', '第2集', '第3集']);
    expect(has(renderer, 'detail-episode-2-current')).toBe(true);
    expect(byTestId(renderer, 'detail-episode-2').props.progress).toBe(0.5);
    expect(byTestId(renderer, 'detail-resume').props.title).toBe('继续播放 · 第3集');
    expect(preferred(renderer)).toEqual(['detail-resume']);
    await act(async () => renderer.unmount());
  });

  it('focuses the keep button when there is nothing to play', async () => {
    mockProvider([{ ...VOD, vod_play_from: '', vod_play_url: '' }]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(texts(renderer)).toContain('暂无播放源');
    expect(has(renderer, 'detail-play')).toBe(false);
    expect(has(renderer, 'detail-sort')).toBe(false);
    expect(preferred(renderer)).toEqual(['detail-collect']);
    await act(async () => renderer.unmount());
  });

  it('lands focus entering the tab row on the selected tab and keeps left/right in the row', async () => {
    mockProvider([VOD], [{ vod_id: 'v1', vod_name: '测试影片' }]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    const inside = (parent: string | ReturnType<typeof tabBar>, testID: string) =>
      (typeof parent === 'string' ? byTestId(renderer, parent) : parent).findAll((node) => node.props.testID === testID)
        .length > 0;
    const guide = () => {
      const { destinations, ...bar } = tabBar(renderer).props;
      const { trapFocusLeft, trapFocusRight, trapFocusUp, trapFocusDown } = bar;
      const tabs = guideOf(renderer, 'detail-tabs').props;
      // The jest View is a component instance; its testID names the tab slot.
      const slots = (tabs.destinations as { props: { testID: string } }[] | undefined)?.map(
        (view) => view.props.testID,
      );
      return { slots, barDestinations: destinations, trapFocusLeft, trapFocusRight, trapFocusUp, trapFocusDown };
    };
    expect(guide()).toMatchObject({ trapFocusLeft: true, trapFocusRight: true });
    // Up and down still leave the row.
    expect(guide().trapFocusUp).toBeUndefined();
    expect(guide().trapFocusDown).toBeUndefined();
    // D-pad down from 立即播放 lands on 剧集, not the nearest tab.
    expect(guide().slots).toEqual(['detail-tab-slot-episodes']);
    // The redirecting guide wraps only the tabs, so its centre sits over the first cards (D-pad up lands on it);
    // the row-wide trap has no destinations of its own.
    expect(guide().barDestinations).toBeUndefined();
    expect(inside(tabBar(renderer), 'detail-tabs')).toBe(true);
    expect(inside(guideOf(renderer, 'detail-tabs'), 'detail-flag-picker')).toBe(false);
    expect(inside('detail-tab-slot-episodes', 'detail-tab-episodes')).toBe(true);
    // The flag picker and 倒序 are in the trapped row too.
    expect(inside(tabBar(renderer), 'detail-flag-picker')).toBe(true);
    expect(inside(tabBar(renderer), 'detail-sort')).toBe(true);
    // An empty 相似推荐 keeps the row trapped, so right from it reaches 演职员.
    await act(async () => byTestId(renderer, 'detail-tab-similar').props.onPress());
    expect(byTestId(renderer, 'detail-similar-status').props.children).toBe('暂无相似推荐');
    expect(guide()).toMatchObject({ trapFocusLeft: true, trapFocusRight: true });
    expect(guide().slots).toEqual(['detail-tab-slot-similar']);
    expect(has(renderer, 'detail-tab-slot-cast')).toBe(true);
    await act(async () => byTestId(renderer, 'detail-tab-cast').props.onPress());
    expect(guide().slots).toEqual(['detail-tab-slot-cast']);
    await act(async () => renderer.unmount());
  });

  it('gives the title room for descenders without moving the layout', async () => {
    mockProvider([{ ...VOD, vod_name: 'Girigo' }]);
    const short = await render({ siteKey: 'cms', vodId: 'v1' });
    const display = title(short.renderer, 'Girigo');
    const k = (display.fontSize as number) / type.display.fontSize;
    expect(display.lineHeight).toBeCloseTo(101 * k, 0);
    expect((display.lineHeight as number) + 2 * (display.marginVertical as number)).toBeCloseTo(
      type.display.lineHeight * k,
      0,
    );
    await act(async () => short.renderer.unmount());

    resetProviderRegistry();
    mockProvider([{ ...VOD, vod_name: 'Girigo Original' }]);
    const long = await render({ siteKey: 'cms', vodId: 'v1' });
    const small = title(long.renderer, 'Girigo Original');
    expect(small.fontSize).toBeCloseTo(type.displaySm.fontSize * k, 0);
    expect(small.lineHeight).toBeCloseTo(83 * k, 0);
    expect((small.lineHeight as number) + 2 * (small.marginVertical as number)).toBeCloseTo(
      type.displaySm.lineHeight * k,
      0,
    );
    await act(async () => long.renderer.unmount());
  });

  it('keeps the focused episode, flag picker and play button rings clear of their neighbours', async () => {
    mockProvider();
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    const k = (title(renderer, '测试影片').fontSize as number) / type.display.fontSize;
    // Design: 8 + 24 from the tab row to the cards; the row adds the focus bleed itself.
    expect(EPISODES_TOP).toBe(32);
    expect(StyleSheet.flatten(tabBar(renderer).props.style).marginBottom).toBeCloseTo(
      (EPISODES_TOP - focus.bleed) * k,
      0,
    );
    const cardRise = ((focus.scale - 1) / 2) * card.wide.height + focus.borderWidth * focus.scale;
    expect(EPISODES_TOP).toBeGreaterThanOrEqual(cardRise + space.sm);
    // The picker's zoom and ring stay space.xs short of 倒序.
    expect(flat(renderer, 'detail-tab-tools').gap).toBeCloseTo(FLAG_PICKER_GAP * k, 0);
    const maxWidth = flat(renderer, 'detail-flag-picker').maxWidth as number;
    const pickerGrowth = ((focus.scale - 1) / 2) * maxWidth + (focus.ringGap + focus.ringWidth) * focus.scale * k;
    expect(FLAG_PICKER_GAP * k).toBeGreaterThanOrEqual(pickerGrowth + space.xs * k);
    expect(FLAG_PICKER_GAP).toBe(28);
    // A focused play button (up to ~560 wide) zooms and rings short of 片单, as Home's hero actions.
    expect(flat(renderer, 'detail-actions').gap).toBeCloseTo(DETAIL_ACTION_GAP * k, 0);
    const playGrowth = ((focus.scale - 1) / 2) * 560 + (focus.ringGap + focus.ringWidth) * focus.scale;
    expect(DETAIL_ACTION_GAP).toBeGreaterThanOrEqual(playGrowth + space.xs);
    expect(DETAIL_ACTION_GAP).toBe(40);
    await act(async () => renderer.unmount());
  });

  it('lists the cast split on separators', async () => {
    mockProvider([{ ...VOD, vod_director: '导演甲', vod_actor: '演员乙，演员丙/演员丁' }]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(has(renderer, 'detail-cast')).toBe(false);
    await act(async () => byTestId(renderer, 'detail-tab-cast').props.onPress());
    expect(byTestId(renderer, 'detail-tab-cast').props.active).toBe(true);
    expect(has(renderer, 'detail-episodes')).toBe(false);
    const chips = byTestId(renderer, 'detail-cast')
      .findAll((node) => typeof node.type !== 'string' && node.props.label !== undefined)
      .map((node) => node.props.label as string);
    expect([...new Set(chips)]).toEqual(['导演甲', '演员乙', '演员丙', '演员丁']);
    await act(async () => renderer.unmount());
  });

  it('searches the home site for similar titles once, without the vod itself', async () => {
    const provider = mockProvider(
      [VOD],
      [
        { vod_id: 'v1', vod_name: '测试影片' },
        { vod_id: 'v2', vod_name: '测试影片2', vod_year: '2023', vod_remarks: '完结' },
        { vod_id: 'v3', vod_name: '测试影片3', vod_remarks: 'HD' },
        { vod_id: 'v4', vod_name: '测试影片4', vod_remarks: '评分：0' },
      ],
    );
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(provider.search).not.toHaveBeenCalled();
    await act(async () => byTestId(renderer, 'detail-tab-similar').props.onPress());
    expect(provider.search).toHaveBeenCalledWith('测试影片', false);
    expect(byTestId(renderer, 'detail-similar-0').props).toMatchObject({ title: '测试影片2', meta: '2023' });
    expect(byTestId(renderer, 'detail-similar-1').props).toMatchObject({ title: '测试影片3', meta: 'HD' });
    // A zero score is no data.
    expect(byTestId(renderer, 'detail-similar-2').props).toMatchObject({ title: '测试影片4', meta: undefined });
    expect(has(renderer, 'detail-similar-3')).toBe(false);
    await act(async () => byTestId(renderer, 'detail-similar-0').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Detail', {
      siteKey: 'cms',
      vodId: 'v2',
      vodName: '测试影片2',
      vodPic: '',
    });
    await act(async () => byTestId(renderer, 'detail-tab-episodes').props.onPress());
    await act(async () => byTestId(renderer, 'detail-tab-similar').props.onPress());
    expect(provider.search).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it('shows the empty and error states of similar titles', async () => {
    const provider = mockProvider([VOD], [{ vod_id: 'v1', vod_name: '测试影片' }]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    await act(async () => byTestId(renderer, 'detail-tab-similar').props.onPress());
    expect(byTestId(renderer, 'detail-similar-status').props.children).toBe('暂无相似推荐');
    await act(async () => renderer.unmount());

    provider.search.mockRejectedValueOnce(new Error('boom'));
    const again = await render({ siteKey: 'cms', vodId: 'v1' });
    await act(async () => byTestId(again.renderer, 'detail-tab-similar').props.onPress());
    expect(byTestId(again.renderer, 'detail-similar-status').props.children).toBe('加载失败：boom');
    await act(async () => again.renderer.unmount());
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
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1', vodName: '参数名称' });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['返回', '参数名称', '加载失败：boom']));
    // ErrorView forwards the flag to its retry button only.
    expect(preferred(renderer)).toEqual(['detail-error', 'detail-error-retry']);
    expect(contentGrow(renderer, 'detail-status')).toBe(1);
    fail = false;
    await act(async () => byTestId(renderer, 'detail-error-retry').props.onPress());
    expect(texts(renderer)).toContain('测试影片');
    // The ready layout keeps its natural content height.
    expect(has(renderer, 'detail-status')).toBe(false);
    expect(contentGrow(renderer, 'detail-body')).toBeUndefined();
    await act(async () => renderer.unmount());
  });

  it('focuses the back pill while the detail loads', async () => {
    const detail = jest.fn(() => new Promise<Result>(() => undefined));
    registerProvider({
      id: 'test',
      match: (site) => site.key === 'cms',
      create: (site) => ({ site, detail }) as unknown as SiteProvider,
    });
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1', vodName: '参数名称' });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['返回', '参数名称', '正在加载…']));
    expect(renderer.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(preferred(renderer)).toEqual(['detail-back']);
    expect(contentGrow(renderer, 'detail-status')).toBe(1);
    await act(async () => renderer.unmount());
  });

  it('reports an empty detail list', async () => {
    mockProvider([]);
    const { renderer } = await render({ siteKey: 'cms', vodId: 'v1' });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['返回', '未找到影片', '重试']));
    expect(contentGrow(renderer, 'detail-status')).toBe(1);
    await act(async () => renderer.unmount());
  });

  it('shows an error for unknown and unsupported sites', async () => {
    clearProviders();
    for (const siteKey of ['missing', 'jar']) {
      const { renderer } = await render({ siteKey, vodId: 'v1' });
      expect(texts(renderer)).toEqual(expect.arrayContaining(['返回', '详情', '站点不可用']));
      expect(has(renderer, 'detail-unavailable')).toBe(true);
      expect(contentGrow(renderer, 'detail-status')).toBe(1);
      expect(texts(renderer)).not.toContain('重试');
      expect(preferred(renderer)).toEqual(['detail-back']);
      await act(async () => renderer.unmount());
    }
  });

  it('disables the keep button and skips history without a cid', async () => {
    mockProvider();
    const { renderer, cid } = await render({ siteKey: 'cms', vodId: 'v1' }, { withCid: false });
    expect(byTestId(renderer, 'detail-collect').props.disabled).toBe(true);
    await act(async () => byTestId(renderer, 'detail-episode-0').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Player', { siteKey: 'cms', vodId: 'v1', flag: 'a', episodeUrl: 'a1' });
    expect(await getHistoryRepository().list(cid!)).toEqual([]);
    await act(async () => renderer.unmount());
  });
});
