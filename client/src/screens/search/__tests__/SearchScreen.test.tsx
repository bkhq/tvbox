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
import { registerProvider, resetProviderRegistry, type SiteProvider } from '../../../core/provider';
import { appSettings, createSettingsStore } from '../../../core/settings';
import { createConfigRepository, MemoryStore } from '../../../core/storage';
import { normalizeResult, type Result } from '../../../core/types';
import type { RootStackScreenProps } from '../../../navigation/types';
import SearchScreen, { SUGGEST_DELAY_MS } from '..';
import { fetchHotWords, fetchSuggestWords } from '../words';

// react-native resolves components lazily on first access; resolve the ones the
// screen renders while the file loads so no test pays that cost inside its timeout.
void [ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput, TVFocusGuideView];

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

jest.mock('../words', () => ({ fetchHotWords: jest.fn(), fetchSuggestWords: jest.fn() }));

const hotWords = jest.mocked(fetchHotWords);
const suggestWords = jest.mocked(fetchSuggestWords);

const URL = 'https://example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [
    { key: 'a', name: '甲站', type: 1, api: 'https://a.example.com/api.php/provide/vod' },
    { key: 'none', name: '空站', type: 1, api: 'https://none.example.com/api.php/provide/vod' },
    { key: 'b', name: '乙站', type: 1, api: 'https://b.example.com/api.php/provide/vod', quickSearch: 0 },
    { key: 'off', name: '关站', type: 1, api: 'https://off.example.com/api.php/provide/vod', searchable: 0 },
  ],
});

const RESULTS: Record<string, string[]> = { a: ['a1', 'a2'], none: [], b: ['b1'] };

function answer(siteKey: string, keyword: string): Result {
  return normalizeResult({
    list: (RESULTS[siteKey] ?? []).map((id) => ({
      vod_id: id,
      vod_name: `${keyword} ${id}`,
      vod_year: id === 'a2' ? '' : '2024',
      vod_remarks: id === 'a2' ? '评分：0' : '更新至1集',
    })),
  });
}

function mockProviders() {
  const search = jest.fn(async (siteKey: string, keyword: string, _quick: boolean) => answer(siteKey, keyword));
  registerProvider({
    id: 'test',
    match: () => true,
    create: (site) =>
      ({ site, search: (key: string, quick: boolean) => search(site.key, key, quick) }) as unknown as SiteProvider,
  });
  return search;
}

async function render(params?: RootStackScreenProps<'Search'>['route']['params']) {
  const store = new MemoryStore();
  const configs = createConfigRepository(store, 'vod');
  await configs.add({ url: URL });
  await configs.setActive(URL);
  const bootstrap = createBootstrap({
    configs,
    settings: createSettingsStore(store),
    loadConfig: (url) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url)),
  });
  await bootstrap.start();
  const screen = (route: RootStackScreenProps<'Search'>['route']['params']) => {
    const props = {
      route: { key: 'Search', name: 'Search', params: route },
    } as unknown as RootStackScreenProps<'Search'>;
    return (
      <BootstrapProvider value={bootstrap}>
        <SearchScreen {...props} />
      </BootstrapProvider>
    );
  };
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(screen(params));
  });
  return { renderer, rerender: (next: typeof params) => act(async () => renderer.update(screen(next))) };
}

function byTestId(renderer: ReactTestRenderer, testID: string) {
  // The outermost match carries the props given by the screen.
  return renderer.root.findAll((node) => node.props.testID === testID)[0]!;
}

const hasTestId = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => node.props.testID === testID).length > 0;

const press = (renderer: ReactTestRenderer, testID: string) =>
  act(async () => byTestId(renderer, testID).props.onPress());

const type = (renderer: ReactTestRenderer, value: string) =>
  act(async () => byTestId(renderer, 'search-input').props.onChangeText(value));

const inputValue = (renderer: ReactTestRenderer) => byTestId(renderer, 'search-input').props.value as string;

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));

const cardIds = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type === 'string' && String(node.props.testID ?? '').startsWith('vod-card-'))
    .map((node) => node.props.testID as string);

describe('SearchScreen', () => {
  // VirtualizedList batches cell updates on a 50 ms timer; fake timers keep it from
  // firing outside act() on a slow host, and unmounting clears it.
  beforeEach(async () => {
    jest.useFakeTimers();
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    hotWords.mockReset().mockResolvedValue([]);
    suggestWords.mockReset().mockResolvedValue([]);
    await appSettings.set('keyword', '');
    await appSettings.set('hot', '');
  });
  afterEach(() => {
    resetProviderRegistry();
    jest.useRealTimers();
  });

  it('edits the keyword with the keys, backspace, long press and 清空', async () => {
    mockProviders();
    const { renderer } = await render();
    expect(byTestId(renderer, 'search-key-A').props.hasTVPreferredFocus).toBe(true);
    expect(
      renderer.root.findAll((node) => typeof node.type === 'string' && node.props.hasTVPreferredFocus === true),
    ).toHaveLength(1);

    for (const key of ['L', 'O', 'V', 'E', 'X']) await press(renderer, `search-key-${key}`);
    expect(inputValue(renderer)).toBe('LOVEX');
    await press(renderer, 'search-key-backspace');
    expect(inputValue(renderer)).toBe('LOVE');
    await act(async () => byTestId(renderer, 'search-key-backspace').props.onLongPress());
    expect(inputValue(renderer)).toBe('');

    for (let i = 0; i < 25; i++) await press(renderer, `search-key-${i % 10}`);
    expect(inputValue(renderer)).toBe('01234567890123456789');
    expect(byTestId(renderer, 'search-input').props.maxLength).toBe(20);
    await press(renderer, 'search-key-clear');
    expect(inputValue(renderer)).toBe('');

    await press(renderer, 'search-back');
    expect(mockGoBack).toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('does not search an empty keyword', async () => {
    const search = mockProviders();
    const { renderer } = await render();
    await press(renderer, 'search-submit');
    expect(search).not.toHaveBeenCalled();
    expect(appSettings.get('keyword')).toBe('');
    await act(async () => renderer.unmount());
  });

  it('shows the results inline with per-site filters and opens Detail with the site key', async () => {
    const search = mockProviders();
    const { renderer } = await render();
    await type(renderer, '流浪');
    await act(async () => byTestId(renderer, 'search-input').props.onSubmitEditing());

    expect(search.mock.calls.map(([siteKey]) => siteKey).sort()).toEqual(['a', 'b', 'none']);
    expect(search).toHaveBeenCalledWith('a', '流浪', false);
    expect(appSettings.get('keyword')).toBe(JSON.stringify(['流浪']));
    expect(texts(renderer)).toEqual(
      expect.arrayContaining(['“流浪” 的搜索结果', '3 个结果', '全部 (3)', '甲站 (2)', '乙站 (1)']),
    );
    expect(hasTestId(renderer, 'search-filter-none')).toBe(false);
    expect(cardIds(renderer)).toEqual(['vod-card-a1', 'vod-card-a2', 'vod-card-b1']);
    // 全部 names the site and the year, leaving out the missing year of a2.
    expect(texts(renderer)).toEqual(expect.arrayContaining(['甲站 · 2024', '甲站', '乙站 · 2024']));
    expect(texts(renderer)).not.toContain('更新至1集');

    await press(renderer, 'search-filter-b');
    expect(byTestId(renderer, 'search-filter-b').props.selected).toBe(true);
    expect(cardIds(renderer)).toEqual(['vod-card-b1']);
    expect(texts(renderer)).toContain('2024 · 更新至1集');

    // A single site hides a zero score in the remarks.
    await press(renderer, 'search-filter-a');
    expect(byTestId(renderer, 'vod-card-a2').props.meta).toBeUndefined();
    expect(texts(renderer)).not.toContain('评分：0');
    await press(renderer, 'search-filter-b');

    await press(renderer, 'vod-card-b1');
    expect(mockNavigate).toHaveBeenCalledWith('Detail', { siteKey: 'b', vodId: 'b1', vodName: '流浪 b1', vodPic: '' });

    await press(renderer, 'search-filter-all');
    await press(renderer, 'vod-card-a2');
    expect(mockNavigate).toHaveBeenLastCalledWith('Detail', expect.objectContaining({ siteKey: 'a', vodId: 'a2' }));
    await act(async () => renderer.unmount());
  });

  it('passes the quick toggle to the search', async () => {
    const search = mockProviders();
    const { renderer } = await render();
    await press(renderer, 'search-quick');
    expect(byTestId(renderer, 'search-quick').props.selected).toBe(true);
    for (const key of ['A', 'B']) await press(renderer, `search-key-${key}`);
    await press(renderer, 'search-submit');

    expect(search.mock.calls.map(([siteKey]) => siteKey).sort()).toEqual(['a', 'none']);
    expect(search).toHaveBeenCalledWith('a', 'AB', true);
    expect(cardIds(renderer)).toEqual(['vod-card-a1', 'vod-card-a2']);
    await act(async () => renderer.unmount());
  });

  it('shows 搜索中… while sites answer and 没有找到相关结果 when none has results', async () => {
    const search = mockProviders();
    const pending: ((result: Result) => void)[] = [];
    search.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));
    const { renderer } = await render({ keyword: '无' });
    expect(texts(renderer)).toContain('0 个结果 · 搜索中…');

    await act(async () => pending.forEach((resolve) => resolve(normalizeResult({ list: [] }))));
    expect(texts(renderer)).toEqual(expect.arrayContaining(['0 个结果', '没有找到相关结果']));
    expect(hasTestId(renderer, 'search-filters')).toBe(false);
    await act(async () => renderer.unmount());
  });

  it('cancels the running search on a new one and starts on 全部 again', async () => {
    const search = mockProviders();
    const { renderer } = await render({ keyword: '流浪' });
    await press(renderer, 'search-filter-b');

    const late: ((result: Result) => void)[] = [];
    search.mockImplementation(async (siteKey, keyword) =>
      keyword === '慢'
        ? new Promise<Result>((resolve) => late.push(() => resolve(answer(siteKey, keyword))))
        : answer(siteKey, keyword),
    );

    await type(renderer, '慢');
    await press(renderer, 'search-submit');
    await type(renderer, '快');
    await press(renderer, 'search-submit');
    expect(texts(renderer)).toContain('“快” 的搜索结果');
    expect(byTestId(renderer, 'search-filter-all').props.selected).toBe(true);
    expect(cardIds(renderer)).toEqual(['vod-card-a1', 'vod-card-a2', 'vod-card-b1']);

    await act(async () => late.forEach((resolve) => resolve(answer('a', '慢'))));
    expect(texts(renderer)).toContain('快 a1');
    expect(texts(renderer)).not.toContain('慢 a1');
    await act(async () => renderer.unmount());
  });

  it('searches a route keyword at once, once per route params', async () => {
    const search = mockProviders();
    const params = { keyword: ' 繁花 ' };
    const { renderer, rerender } = await render(params);
    expect(inputValue(renderer)).toBe('繁花');
    expect(search).toHaveBeenCalledWith('a', '繁花', false);
    expect(texts(renderer)).toContain('“繁花” 的搜索结果');
    expect(appSettings.get('keyword')).toBe(JSON.stringify(['繁花']));

    await rerender(params);
    expect(search).toHaveBeenCalledTimes(3);
    await rerender({ keyword: '繁花' });
    expect(search).toHaveBeenCalledTimes(6);
    await act(async () => renderer.unmount());
  });

  it('keeps the latest ten keywords, newest first, and removes one on long press', async () => {
    mockProviders();
    await appSettings.set('keyword', JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']));
    const { renderer } = await render();
    expect(texts(renderer)).toEqual(expect.arrayContaining(['搜索历史', '长按删除']));

    await press(renderer, 'search-history-c');
    expect(inputValue(renderer)).toBe('c');
    expect(texts(renderer)).toContain('“c” 的搜索结果');
    expect(JSON.parse(appSettings.get('keyword'))).toEqual(['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);

    await type(renderer, 'k');
    await act(async () => byTestId(renderer, 'search-input').props.onSubmitEditing());
    expect(JSON.parse(appSettings.get('keyword'))).toEqual(['k', 'c', 'a', 'b', 'd', 'e', 'f', 'g', 'h', 'i']);

    await press(renderer, 'search-key-clear');
    await act(async () => byTestId(renderer, 'search-history-a').props.onLongPress());
    expect(hasTestId(renderer, 'search-history-a')).toBe(false);
    expect(JSON.parse(appSettings.get('keyword'))).not.toContain('a');
    await act(async () => renderer.unmount());
  });

  it('shows the cached hot words, then the fresh ones', async () => {
    const search = mockProviders();
    await appSettings.set('hot', JSON.stringify(['旧词']));
    let resolve!: (words: string[]) => void;
    hotWords.mockReturnValue(new Promise((done) => (resolve = done)));
    const { renderer } = await render();
    expect(texts(renderer)).toEqual(expect.arrayContaining(['热门搜索', '旧词']));

    await act(async () => resolve(['新词']));
    expect(hasTestId(renderer, 'search-hot-新词')).toBe(true);
    expect(appSettings.get('hot')).toBe(JSON.stringify(['新词']));

    await press(renderer, 'search-hot-新词');
    expect(search).toHaveBeenCalledWith('a', '新词', false);
    expect(texts(renderer)).toContain('“新词” 的搜索结果');
    await act(async () => renderer.unmount());
  });

  it('asks for suggestions after a typing pause and searches the picked one', async () => {
    const search = mockProviders();
    suggestWords.mockResolvedValue(['功夫女足']);
    const { renderer } = await render();

    await type(renderer, '功');
    await type(renderer, '功夫');
    expect(suggestWords).not.toHaveBeenCalled();

    await act(async () => jest.advanceTimersByTime(SUGGEST_DELAY_MS));
    expect(suggestWords).toHaveBeenCalledTimes(1);
    expect(suggestWords).toHaveBeenCalledWith('功夫', expect.anything());
    expect(texts(renderer)).toEqual(expect.arrayContaining(['猜你想搜', '功夫女足']));
    expect(hasTestId(renderer, 'search-results')).toBe(false);

    await press(renderer, 'search-suggest-功夫女足');
    expect(search).toHaveBeenCalledWith('a', '功夫女足', false);
    expect(hasTestId(renderer, 'search-results')).toBe(true);
    expect(hasTestId(renderer, 'search-suggest')).toBe(false);
    await act(async () => renderer.unmount());
  });
});
