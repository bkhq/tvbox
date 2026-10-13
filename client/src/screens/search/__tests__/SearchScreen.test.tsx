import { Pressable, ScrollView, Text, TextInput } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { appSettings } from '../../../core/settings';
import type { RootStackScreenProps } from '../../../navigation/types';
import SearchScreen, { SUGGEST_DELAY_MS } from '..';
import { fetchHotWords, fetchSuggestWords } from '../words';

void [Pressable, ScrollView, TextInput];

const mockNavigate = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({ useAppNavigation: () => ({ navigate: mockNavigate }) }));

jest.mock('../words', () => ({ fetchHotWords: jest.fn(), fetchSuggestWords: jest.fn() }));

const hotWords = jest.mocked(fetchHotWords);
const suggestWords = jest.mocked(fetchSuggestWords);

async function render(params?: RootStackScreenProps<'Search'>['route']['params']) {
  const props = { route: { key: 'Search', name: 'Search', params } } as unknown as RootStackScreenProps<'Search'>;
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<SearchScreen {...props} />);
  });
  return renderer;
}

function byTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll((node) => node.props.testID === testID)[0]!;
}

const hasTestId = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => node.props.testID === testID).length > 0;

const press = (renderer: ReactTestRenderer, testID: string) =>
  act(async () => byTestId(renderer, testID).props.onPress());

const inputValue = (renderer: ReactTestRenderer) => byTestId(renderer, 'search-input').props.value as string;

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));

describe('SearchScreen', () => {
  beforeEach(async () => {
    jest.useFakeTimers();
    mockNavigate.mockClear();
    hotWords.mockReset().mockResolvedValue([]);
    suggestWords.mockReset().mockResolvedValue([]);
    await appSettings.set('keyword', '');
    await appSettings.set('hot', '');
  });
  afterEach(() => jest.useRealTimers());

  it('types with the on-screen keyboard and opens the results', async () => {
    const renderer = await render();
    expect(byTestId(renderer, 'search-key-A').props.hasTVPreferredFocus).toBe(true);

    for (const key of ['L', 'O', 'V', 'E', 'X']) await press(renderer, `search-key-${key}`);
    expect(inputValue(renderer)).toBe('LOVEX');
    await press(renderer, 'search-key-backspace');
    expect(inputValue(renderer)).toBe('LOVE');

    await press(renderer, 'search-quick');
    await press(renderer, 'search-submit');
    expect(mockNavigate).toHaveBeenCalledWith('SearchResult', { keyword: 'LOVE', quick: true });
    expect(appSettings.get('keyword')).toBe(JSON.stringify(['LOVE']));

    await press(renderer, 'search-key-clear');
    expect(inputValue(renderer)).toBe('');
    await act(async () => renderer.unmount());
  });

  it('does not search an empty keyword', async () => {
    const renderer = await render();
    await press(renderer, 'search-submit');
    expect(mockNavigate).not.toHaveBeenCalled();
    await act(async () => renderer.unmount());
  });

  it('searches a route keyword at once', async () => {
    const renderer = await render({ keyword: ' 繁花 ' });
    expect(mockNavigate).toHaveBeenCalledWith('SearchResult', { keyword: '繁花', quick: false });
    expect(inputValue(renderer)).toBe('繁花');
    await act(async () => renderer.unmount());
  });

  it('keeps the latest ten keywords, newest first, and removes one on long press', async () => {
    await appSettings.set('keyword', JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']));
    const renderer = await render();

    await press(renderer, 'search-history-c');
    expect(mockNavigate).toHaveBeenCalledWith('SearchResult', { keyword: 'c', quick: false });
    expect(JSON.parse(appSettings.get('keyword'))).toEqual(['c', 'a', 'b', 'd', 'e', 'f', 'g', 'h', 'i', 'j']);

    await act(async () => byTestId(renderer, 'search-input').props.onChangeText('k'));
    await act(async () => byTestId(renderer, 'search-input').props.onSubmitEditing());
    expect(JSON.parse(appSettings.get('keyword'))).toEqual(['k', 'c', 'a', 'b', 'd', 'e', 'f', 'g', 'h', 'i']);

    await act(async () => byTestId(renderer, 'search-history-a').props.onLongPress());
    expect(hasTestId(renderer, 'search-history-a')).toBe(false);
    expect(JSON.parse(appSettings.get('keyword'))).not.toContain('a');
    await act(async () => renderer.unmount());
  });

  it('shows the cached hot words, then the fresh ones', async () => {
    await appSettings.set('hot', JSON.stringify(['旧词']));
    let resolve!: (words: string[]) => void;
    hotWords.mockReturnValue(new Promise((done) => (resolve = done)));
    const renderer = await render();
    expect(texts(renderer)).toEqual(expect.arrayContaining(['热门搜索', '旧词']));

    await act(async () => resolve(['新词']));
    expect(hasTestId(renderer, 'search-word-新词')).toBe(true);
    expect(appSettings.get('hot')).toBe(JSON.stringify(['新词']));

    await press(renderer, 'search-word-新词');
    expect(mockNavigate).toHaveBeenCalledWith('SearchResult', { keyword: '新词', quick: false });
    await act(async () => renderer.unmount());
  });

  it('asks for suggestions after a typing pause', async () => {
    suggestWords.mockResolvedValue(['功夫女足']);
    const renderer = await render();

    await act(async () => byTestId(renderer, 'search-input').props.onChangeText('功'));
    await act(async () => byTestId(renderer, 'search-input').props.onChangeText('功夫'));
    expect(suggestWords).not.toHaveBeenCalled();

    await act(async () => jest.advanceTimersByTime(SUGGEST_DELAY_MS));
    expect(suggestWords).toHaveBeenCalledTimes(1);
    expect(suggestWords).toHaveBeenCalledWith('功夫', expect.anything());
    expect(texts(renderer)).toEqual(expect.arrayContaining(['猜你想搜', '功夫女足']));
    await act(async () => renderer.unmount());
  });
});
