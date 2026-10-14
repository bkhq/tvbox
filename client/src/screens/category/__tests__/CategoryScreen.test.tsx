import {
  ActivityIndicator,
  BackHandler,
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
import { createConfigRepository, MemoryStore } from '../../../core/storage';
import { normalizeResult, type Result } from '../../../core/types';
import { Chip } from '../../../ui';
import type { RootStackScreenProps } from '../../../navigation/types';
import CategoryScreen from '..';

// react-native resolves components lazily on first access; resolve the ones the
// screen renders while the file loads so no test pays that cost inside its timeout.
void [ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput, TVFocusGuideView];

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack }),
}));

const URL = 'https://example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [
    { key: 'cms', name: 'CMS 站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' },
    { key: 'jar', name: 'Jar 站', type: 3, api: 'csp_Jar' },
  ],
});

const FILTERS = {
  movie: [
    {
      key: 'year',
      name: '年份',
      value: [
        { n: '全部', v: '' },
        { n: '2024', v: '2024' },
      ],
    },
  ],
};

function vods(page: number, extend: Record<string, string>) {
  const tag = extend.year ?? 'all';
  return [1, 2].map((n) => ({
    vod_id: `${tag}-${page}-${n}`,
    vod_name: `影片 ${tag} ${page}-${n}`,
    vod_pic: `https://img.example.com/${page}-${n}.jpg`,
    vod_remarks: '更新至1集',
  }));
}

function mockProvider(options: { homeFails?: boolean } = {}) {
  const category = jest.fn(
    async (_tid: string, page: string, _filter: boolean, extend: Record<string, string>): Promise<Result> =>
      normalizeResult({ list: vods(Number(page), extend), page: Number(page), pagecount: 3 }),
  );
  const home = jest.fn(async () => {
    if (options.homeFails) throw new Error('home failed');
    return normalizeResult({ filters: FILTERS });
  });
  registerProvider({
    id: 'test',
    match: (site) => site.key === 'cms',
    create: (site) => ({ site, home, category }) as unknown as SiteProvider,
  });
  return { home, category };
}

async function render(params: RootStackScreenProps<'Category'>['route']['params']) {
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
  const props = { route: { key: 'Category', name: 'Category', params } } as unknown as RootStackScreenProps<'Category'>;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <CategoryScreen {...props} />
      </BootstrapProvider>,
    );
  });
  return renderer;
}

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

function byTestId(renderer: ReactTestRenderer, testID: string) {
  // The outermost match carries the props given by the screen.
  return renderer.root.findAll((node) => node.props.testID === testID)[0]!;
}

const cardIds = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type === 'string' && String(node.props.testID ?? '').startsWith('vod-card-'))
    .map((node) => node.props.testID as string);

describe('CategoryScreen', () => {
  // VirtualizedList batches cell updates on a 50 ms timer; fake timers keep it from
  // firing outside act() on a slow host, and unmounting clears it.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
  });
  afterEach(() => resetProviderRegistry());

  it('renders the first page and loads the next one at the end of the grid', async () => {
    const { home, category } = mockProvider();
    const renderer = await render({ siteKey: 'cms', typeId: 'movie', typeName: '电影' });

    expect(home).toHaveBeenCalledWith(true);
    expect(category).toHaveBeenCalledWith('movie', '1', true, {});
    expect(texts(renderer)).toEqual(expect.arrayContaining(['电影', '筛选', '影片 all 1-1', '更新至1集']));
    expect(cardIds(renderer)).toEqual(['vod-card-all-1-1', 'vod-card-all-1-2']);
    expect(byTestId(renderer, 'vod-card-all-1-1').props.hasTVPreferredFocus).toBe(true);
    expect(byTestId(renderer, 'category-filter-toggle').props.hasTVPreferredFocus).toBe(false);
    expect(byTestId(renderer, 'category-back').props.hasTVPreferredFocus).toBeUndefined();
    expect(byTestId(renderer, 'vod-card-all-1-1').props).toMatchObject({ width: 224, meta: '更新至1集' });
    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(7);

    await act(async () => byTestId(renderer, 'vod-grid').props.onEndReached());
    expect(category).toHaveBeenLastCalledWith('movie', '2', true, {});
    expect(cardIds(renderer)).toEqual(['vod-card-all-1-1', 'vod-card-all-1-2', 'vod-card-all-2-1', 'vod-card-all-2-2']);
    await act(async () => renderer.unmount());
  });

  it('reloads from page 1 with the new extend when a filter changes', async () => {
    const { category } = mockProvider();
    const renderer = await render({ siteKey: 'cms', typeId: 'movie', typeName: '电影' });
    await act(async () => byTestId(renderer, 'vod-grid').props.onEndReached());

    await act(async () => byTestId(renderer, 'category-filter-toggle').props.onPress());
    expect(byTestId(renderer, 'category-filter-year-0').props).toMatchObject({
      selected: true,
      hasTVPreferredFocus: true,
    });
    expect(byTestId(renderer, 'category-filter-year-1').props).toMatchObject({
      selected: false,
      hasTVPreferredFocus: false,
    });
    expect(renderer.root.findAllByType(Chip).map((chip) => chip.props.label)).toEqual(['全部', '2024']);
    expect(texts(renderer)).toContain('年份');
    expect(byTestId(renderer, 'vod-card-all-1-1').props.hasTVPreferredFocus).toBe(false);

    await act(async () => byTestId(renderer, 'category-filter-year-1').props.onPress());
    expect(category).toHaveBeenLastCalledWith('movie', '1', true, { year: '2024' });
    expect(cardIds(renderer)).toEqual(['vod-card-2024-1-1', 'vod-card-2024-1-2']);
    expect(byTestId(renderer, 'category-filter-year-1').props.selected).toBe(true);

    await act(async () => byTestId(renderer, 'category-filter-year-0').props.onPress());
    expect(category).toHaveBeenLastCalledWith('movie', '1', true, {});
    await act(async () => renderer.unmount());
  });

  it('closes the filter panel on back before leaving', async () => {
    mockProvider();
    const handlers: (() => boolean)[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      const listener = handler as () => boolean;
      handlers.push(listener);
      return {
        remove: () => {
          handlers.splice(handlers.indexOf(listener), 1);
        },
      };
    });
    const renderer = await render({ siteKey: 'cms', typeId: 'movie', typeName: '电影' });
    await act(async () => byTestId(renderer, 'category-filter-toggle').props.onPress());
    expect(renderer.root.findAll((node) => node.props.testID === 'category-filter-panel')).not.toHaveLength(0);

    let handled = false;
    await act(async () => {
      handled = handlers.some((handler) => handler());
    });
    expect(handled).toBe(true);
    expect(renderer.root.findAll((node) => node.props.testID === 'category-filter-panel')).toHaveLength(0);
    expect(handlers).toHaveLength(0);
    spy.mockRestore();
    await act(async () => renderer.unmount());
  });

  it('opens Detail when a card is pressed', async () => {
    mockProvider();
    const renderer = await render({ siteKey: 'cms', typeId: 'movie', typeName: '电影' });
    await act(async () => byTestId(renderer, 'vod-card-all-1-2').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Detail', {
      siteKey: 'cms',
      vodId: 'all-1-2',
      vodName: '影片 all 1-2',
      vodPic: 'https://img.example.com/1-2.jpg',
    });
    await act(async () => renderer.unmount());
  });

  it('goes back from the back pill', async () => {
    mockProvider();
    const renderer = await render({ siteKey: 'cms', typeId: 'movie', typeName: '电影' });
    await act(async () => byTestId(renderer, 'category-back').props.onPress());
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it('retries a failed first page', async () => {
    const { category } = mockProvider();
    category.mockRejectedValueOnce(new Error('boom'));
    const renderer = await render({ siteKey: 'cms', typeId: 'movie', typeName: '电影' });
    expect(texts(renderer)).toContain('加载失败：boom');
    await act(async () => byTestId(renderer, 'category-error-retry').props.onPress());
    expect(cardIds(renderer)).toEqual(['vod-card-all-1-1', 'vod-card-all-1-2']);
    await act(async () => renderer.unmount());
  });

  it('works without filters when homeContent fails', async () => {
    const { category } = mockProvider({ homeFails: true });
    const renderer = await render({ siteKey: 'cms', typeId: 'movie', typeName: '电影' });
    expect(category).toHaveBeenCalledWith('movie', '1', true, {});
    expect(texts(renderer)).not.toContain('筛选');
    await act(async () => renderer.unmount());
  });

  it('shows an error for unknown and unsupported sites', async () => {
    clearProviders();
    for (const siteKey of ['missing', 'jar']) {
      const renderer = await render({ siteKey, typeId: 'movie', typeName: '电影' });
      expect(texts(renderer)).toContain('站点不可用');
      await act(async () => renderer.unmount());
    }
  });
});
