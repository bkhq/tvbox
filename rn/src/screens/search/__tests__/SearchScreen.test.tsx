import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { BootstrapProvider, createBootstrap } from '../../../core/bootstrap';
import { parseVodConfig } from '../../../core/config';
import { registerProvider, resetProviderRegistry, type SiteProvider } from '../../../core/provider';
import { createSettingsStore } from '../../../core/settings';
import { createConfigRepository, MemoryStore } from '../../../core/storage';
import { normalizeResult, type Result } from '../../../core/types';
import type { RootStackScreenProps } from '../../../navigation/types';
import SearchScreen from '..';
import { clearHistory } from '../history';

const mockNavigate = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ navigate: mockNavigate }),
}));

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

function mockProviders() {
  const search = jest.fn(
    async (siteKey: string, keyword: string, _quick: boolean): Promise<Result> =>
      normalizeResult({
        list: (RESULTS[siteKey] ?? []).map((id) => ({ vod_id: id, vod_name: `${keyword} ${id}`, vod_remarks: '更新至1集' })),
      }),
  );
  registerProvider({
    id: 'test',
    match: () => true,
    create: (site) =>
      ({ site, search: (key: string, quick: boolean) => search(site.key, key, quick) }) as unknown as SiteProvider,
  });
  return search;
}

async function render(params: RootStackScreenProps<'Search'>['route']['params']) {
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
  const props = { route: { key: 'Search', name: 'Search', params } } as unknown as RootStackScreenProps<'Search'>;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BootstrapProvider value={bootstrap}>
        <SearchScreen {...props} />
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

const hasTestId = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => node.props.testID === testID).length > 0;

const cardIds = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.type === 'string' && String(node.props.testID ?? '').startsWith('vod-card-'))
    .map((node) => node.props.testID as string);

describe('SearchScreen', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    clearHistory();
  });
  afterEach(() => resetProviderRegistry());

  it('searches the route keyword and groups the results by site', async () => {
    const search = mockProviders();
    const renderer = await render({ keyword: '流浪' });

    expect(search.mock.calls.map(([siteKey]) => siteKey).sort()).toEqual(['a', 'b', 'none']);
    expect(search).toHaveBeenCalledWith('a', '流浪', false);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['搜索', '全部 (3)', '甲站 (2)', '乙站 (1)']));
    expect(hasTestId(renderer, 'search-filter-none')).toBe(false);
    expect(cardIds(renderer)).toEqual(['vod-card-a1', 'vod-card-a2', 'vod-card-b1']);
    // The aggregated view shows the site name instead of the remarks.
    expect(texts(renderer)).toEqual(expect.arrayContaining(['甲站', '乙站']));
    expect(byTestId(renderer, 'vod-card-a1').props.hasTVPreferredFocus).toBe(true);
    expect(byTestId(renderer, 'search-input').props.hasTVPreferredFocus).toBe(false);
  });

  it('narrows the grid to the selected site and opens Detail with its key', async () => {
    mockProviders();
    const renderer = await render({ keyword: '流浪' });

    await act(async () => byTestId(renderer, 'search-filter-b').props.onPress());
    expect(cardIds(renderer)).toEqual(['vod-card-b1']);
    expect(texts(renderer)).toContain('更新至1集');

    await act(async () => byTestId(renderer, 'vod-card-b1').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Detail', { siteKey: 'b', vodId: 'b1', vodName: '流浪 b1', vodPic: '' });

    await act(async () => byTestId(renderer, 'search-filter-all').props.onPress());
    await act(async () => byTestId(renderer, 'vod-card-a2').props.onPress());
    expect(mockNavigate).toHaveBeenLastCalledWith('Detail', expect.objectContaining({ siteKey: 'a', vodId: 'a2' }));
  });

  it('focuses the input without a keyword and searches on submit, keeping history', async () => {
    const search = mockProviders();
    const renderer = await render(undefined);

    expect(search).not.toHaveBeenCalled();
    expect(byTestId(renderer, 'search-input').props.hasTVPreferredFocus).toBe(true);
    expect(hasTestId(renderer, 'vod-grid')).toBe(false);

    await act(async () => byTestId(renderer, 'search-input').props.onChangeText('星际'));
    await act(async () => byTestId(renderer, 'search-submit').props.onPress());
    expect(search).toHaveBeenCalledWith('a', '星际', false);
    expect(cardIds(renderer)).toEqual(['vod-card-a1', 'vod-card-a2', 'vod-card-b1']);

    await act(async () => byTestId(renderer, 'search-input').props.onChangeText(''));
    expect(hasTestId(renderer, 'search-history-星际')).toBe(true);
  });

  it('skips sites without quick search in quick mode', async () => {
    const search = mockProviders();
    const renderer = await render({ keyword: '流浪' });
    search.mockClear();

    await act(async () => byTestId(renderer, 'search-quick').props.onPress());
    expect(search.mock.calls.map(([siteKey]) => siteKey).sort()).toEqual(['a', 'none']);
    expect(search).toHaveBeenCalledWith('a', '流浪', true);
    expect(cardIds(renderer)).toEqual(['vod-card-a1', 'vod-card-a2']);
  });

  it('shows 未找到结果 when no site returns anything', async () => {
    const search = mockProviders();
    search.mockImplementation(async () => normalizeResult({ list: [] }));
    const renderer = await render({ keyword: '无' });

    expect(texts(renderer)).toEqual(expect.arrayContaining(['搜索', '未找到结果']));
    expect(byTestId(renderer, 'search-input').props.hasTVPreferredFocus).toBe(true);
  });
});
