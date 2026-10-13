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
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { BootstrapProvider, createBootstrap } from '../../../core/bootstrap';
import { parseVodConfig } from '../../../core/config';
import { createSettingsStore } from '../../../core/settings';
import { createConfigRepository, historyKey, MemoryStore } from '../../../core/storage';
import { getHistoryRepository, setUserDataStore } from '../../../core/userData';
import HistoryScreen, { formatPosition, HistoryView, useHistoryCount } from '..';

// react-native resolves components lazily on first access; resolve the ones the
// screen renders while the file loads so no test pays that cost inside its timeout.
void [ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput, TVFocusGuideView];

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
const mockFocusListeners: (() => void)[] = [];
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    addListener: (_event: string, listener: () => void) => {
      mockFocusListeners.push(listener);
      return () => mockFocusListeners.splice(mockFocusListeners.indexOf(listener), 1);
    },
  }),
}));

const URL = 'https://example.com/config.json';
const CONFIG_TEXT = JSON.stringify({
  sites: [{ key: 'cms', name: 'CMS 站', type: 1, api: 'https://cms.example.com/api.php/provide/vod' }],
});

// Repositories stamp createTime with Date.now; distinct stamps keep the order deterministic.
// Runs under fake timers, so this moves Date.now without waiting.
const tick = () => jest.advanceTimersByTime(5);

function texts(renderer: ReactTestRenderer): string[] {
  return renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
}

function byTestId(renderer: ReactTestRenderer, testID: string) {
  return renderer.root.findAll((node) => node.props.testID === testID)[0]!;
}

const cardIds = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll(
      (node) =>
        typeof node.type === 'string' &&
        String(node.props.testID ?? '').startsWith('history-card-') &&
        !String(node.props.testID).endsWith('-progress'),
    )
    .map((node) => String(node.props.testID).slice('history-card-'.length));

// Renders useHistoryCount() as text; "undefined" while there is no count.
function CountProbe() {
  return <Text testID="count">{String(useHistoryCount())}</Text>;
}
const countOf = (renderer: ReactTestRenderer) => byTestId(renderer, 'count').props.children as string;

async function render(
  options: { saved?: boolean; seed?: (cid: number) => Promise<void>; element?: ReactElement } = {},
) {
  const store = new MemoryStore();
  setUserDataStore(new MemoryStore());
  const configs = createConfigRepository(store, 'vod');
  if (options.saved !== false) {
    await configs.add({ url: URL });
    await configs.setActive(URL);
  }
  const bootstrap = createBootstrap({
    configs,
    settings: createSettingsStore(store),
    loadConfig: (url) => Promise.resolve(parseVodConfig(CONFIG_TEXT, url)),
  });
  await bootstrap.start();
  const cid = bootstrap.getSnapshot().entry?.id;
  if (cid !== undefined) await options.seed?.(cid);
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BootstrapProvider value={bootstrap}>{options.element ?? <HistoryScreen />}</BootstrapProvider>);
  });
  return { renderer, cid: cid ?? -1 };
}

async function seedTwo(cid: number) {
  const repo = getHistoryRepository();
  await repo.upsert({
    key: historyKey('cms', 'old'),
    cid,
    vodName: '旧片',
    vodPic: 'https://img/old.jpg',
    vodRemarks: '第1集',
  });
  tick();
  await repo.upsert({
    key: historyKey('cms', 'new'),
    cid,
    vodName: '新片',
    vodPic: 'https://img/new.jpg',
    position: 65_000,
    duration: 130_000,
  });
}

describe('HistoryScreen', () => {
  // VirtualizedList batches cell updates on a 50 ms timer; fake timers keep it from
  // firing outside act() on a slow host, and unmounting clears it.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
    mockFocusListeners.length = 0;
  });
  afterAll(() => setUserDataStore(undefined));

  it('formats positions', () => {
    expect(formatPosition(65_000)).toBe('01:05');
    expect(formatPosition(3_725_000)).toBe('1:02:05');
  });

  it('lists records newest first and opens Detail with the split key', async () => {
    const { renderer } = await render({ seed: seedTwo });
    expect(cardIds(renderer)).toEqual(['cms@@@new', 'cms@@@old']);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['历史记录', '保存在本机', '看到 01:05', '第1集']));
    expect(byTestId(renderer, 'history-card-cms@@@new').props.progress).toBe(0.5);
    expect(byTestId(renderer, 'history-card-cms@@@old').props.progress).toBeUndefined();
    expect(byTestId(renderer, 'history-card-cms@@@new').props.hasTVPreferredFocus).toBe(true);
    expect(byTestId(renderer, 'history-edit').props.hasTVPreferredFocus).toBe(false);

    await act(async () => byTestId(renderer, 'history-card-cms@@@new').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Detail', {
      siteKey: 'cms',
      vodId: 'new',
      vodName: '新片',
      vodPic: 'https://img/new.jpg',
    });
    await act(async () => renderer.unmount());
  });

  it('refreshes when the screen regains focus', async () => {
    const { renderer, cid } = await render();
    expect(texts(renderer)).toContain('没有观看记录。');
    expect(byTestId(renderer, 'history-edit').props.hasTVPreferredFocus).toBe(true);
    await getHistoryRepository().upsert({ key: historyKey('cms', 'v'), cid, vodName: '影片' });
    await act(async () => mockFocusListeners.forEach((listener) => listener()));
    expect(cardIds(renderer)).toEqual(['cms@@@v']);
    await act(async () => renderer.unmount());
  });

  it('deletes a record in edit mode and back leaves edit mode', async () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      const listener = handler as () => boolean;
      handlers.push(listener);
      return { remove: () => void handlers.splice(handlers.indexOf(listener), 1) };
    });
    const { renderer, cid } = await render({ seed: seedTwo });
    await act(async () => byTestId(renderer, 'history-edit').props.onPress());
    await act(async () => byTestId(renderer, 'history-card-cms@@@new').props.onPress());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(cardIds(renderer)).toEqual(['cms@@@old']);
    expect((await getHistoryRepository().list(cid)).map((item) => item.key)).toEqual(['cms@@@old']);

    let handled = false;
    await act(async () => {
      handled = handlers.some((handler) => handler());
    });
    expect(handled).toBe(true);
    expect(handlers).toHaveLength(0);
    await act(async () => byTestId(renderer, 'history-card-cms@@@old').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Detail', expect.objectContaining({ siteKey: 'cms', vodId: 'old' }));
    spy.mockRestore();
    await act(async () => renderer.unmount());
  });

  it('clears all records after confirming', async () => {
    const { renderer, cid } = await render({ seed: seedTwo });
    await act(async () => byTestId(renderer, 'history-clear').props.onPress());
    expect(byTestId(renderer, 'history-confirm-ok').props.hasTVPreferredFocus).toBe(true);
    expect(byTestId(renderer, 'history-card-cms@@@new').props.hasTVPreferredFocus).toBe(false);

    await act(async () => byTestId(renderer, 'history-confirm-cancel').props.onPress());
    expect(cardIds(renderer)).toHaveLength(2);

    await act(async () => byTestId(renderer, 'history-clear').props.onPress());
    await act(async () => byTestId(renderer, 'history-confirm-ok').props.onPress());
    expect(cardIds(renderer)).toEqual([]);
    expect(texts(renderer)).toContain('没有观看记录。');
    expect(await getHistoryRepository().list(cid)).toEqual([]);
    await act(async () => renderer.unmount());
  });

  it('asks for a config when none is active', async () => {
    const { renderer } = await render({ saved: false });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['历史记录', '请先添加配置']));
    await act(async () => renderer.unmount());
  });

  it('goes back from the back button', async () => {
    const { renderer } = await render();
    await act(async () => byTestId(renderer, 'history-back').props.onPress());
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it('back closes the confirm card before leaving edit mode', async () => {
    const handlers: (() => boolean)[] = [];
    const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
      const listener = handler as () => boolean;
      handlers.push(listener);
      return { remove: () => void handlers.splice(handlers.indexOf(listener), 1) };
    });
    const { renderer } = await render({ seed: seedTwo });
    await act(async () => byTestId(renderer, 'history-edit').props.onPress());
    await act(async () => byTestId(renderer, 'history-clear').props.onPress());
    await act(async () => void handlers.some((handler) => handler()));
    expect(renderer.root.findAll((node) => node.props.testID === 'history-confirm')).toHaveLength(0);
    expect(texts(renderer)).toContain('按卡片删除');
    await act(async () => void handlers.some((handler) => handler()));
    expect(texts(renderer)).not.toContain('按卡片删除');
    expect(handlers).toHaveLength(0);
    spy.mockRestore();
    await act(async () => renderer.unmount());
  });

  it('embeds without a back button or initial focus and keeps the count in sync', async () => {
    const { renderer } = await render({
      seed: seedTwo,
      element: (
        <>
          <HistoryView embedded />
          <CountProbe />
        </>
      ),
    });
    expect(cardIds(renderer)).toEqual(['cms@@@new', 'cms@@@old']);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['观看历史', '保存在本机']));
    expect(renderer.root.findAll((node) => node.props.testID === 'history-back')).toHaveLength(0);
    expect(byTestId(renderer, 'history-card-cms@@@new').props.hasTVPreferredFocus).toBe(false);
    expect(byTestId(renderer, 'history-card-cms@@@new').props.width).toBe(286);
    expect(countOf(renderer)).toBe('2');

    await act(async () => byTestId(renderer, 'history-edit').props.onPress());
    await act(async () => byTestId(renderer, 'history-card-cms@@@new').props.onPress());
    expect(cardIds(renderer)).toEqual(['cms@@@old']);
    expect(countOf(renderer)).toBe('1');

    await act(async () => byTestId(renderer, 'history-clear').props.onPress());
    await act(async () => byTestId(renderer, 'history-confirm-ok').props.onPress());
    expect(texts(renderer)).toContain('没有观看记录。');
    expect(countOf(renderer)).toBe('0');
    await act(async () => renderer.unmount());
  });

  it('takes the initial focus when embedded with hasTVPreferredFocus', async () => {
    const { renderer } = await render({ seed: seedTwo, element: <HistoryView embedded hasTVPreferredFocus /> });
    expect(byTestId(renderer, 'history-card-cms@@@new').props.hasTVPreferredFocus).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('counts records on focus and has no count without a config', async () => {
    const { renderer, cid } = await render({ element: <CountProbe /> });
    expect(countOf(renderer)).toBe('0');
    await getHistoryRepository().upsert({ key: historyKey('cms', 'v'), cid, vodName: '影片' });
    await act(async () => mockFocusListeners.forEach((listener) => listener()));
    expect(countOf(renderer)).toBe('1');
    await act(async () => renderer.unmount());

    const none = await render({ saved: false, element: <CountProbe /> });
    expect(countOf(none.renderer)).toBe('undefined');
    await act(async () => none.renderer.unmount());
  });
});
