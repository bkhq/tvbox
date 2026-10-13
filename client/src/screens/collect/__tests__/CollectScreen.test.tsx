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
import type { ReactElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { BootstrapProvider, createBootstrap } from '../../../core/bootstrap';
import { parseVodConfig } from '../../../core/config';
import { createSettingsStore } from '../../../core/settings';
import { createConfigRepository, historyKey, MemoryStore } from '../../../core/storage';
import { getKeepRepository, setUserDataStore } from '../../../core/userData';
import CollectScreen, { CollectView, useCollectCount } from '..';

// react-native resolves components lazily on first access; resolve the ones the
// screen renders while the file loads so no test pays that cost inside its timeout.
void [ActivityIndicator, FlatList, Image, Modal, Pressable, ScrollView, TextInput, TVFocusGuideView];

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({
  useAppNavigation: () => ({ navigate: mockNavigate, goBack: mockGoBack, addListener: () => () => undefined }),
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
    .findAll((node) => typeof node.type === 'string' && String(node.props.testID ?? '').startsWith('collect-card-'))
    .map((node) => String(node.props.testID).slice('collect-card-'.length));

// Renders useCollectCount() as text; "undefined" while there is no count.
function CountProbe() {
  return <Text testID="count">{String(useCollectCount())}</Text>;
}
const countOf = (renderer: ReactTestRenderer) => byTestId(renderer, 'count').props.children as string;

async function render(
  options: { saved?: boolean; seed?: boolean; element?: ReactElement; beforeMount?: () => void } = {},
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
  const cid = bootstrap.getSnapshot().entry?.id ?? -1;
  if (options.seed) {
    const repo = getKeepRepository();
    await repo.add({
      key: historyKey('cms', 'a'),
      cid,
      siteName: 'CMS 站',
      vodName: '甲',
      vodPic: 'https://img/a.jpg',
    });
    // A site the current config no longer has still opens Detail.
    tick();
    await repo.add({ key: historyKey('gone', 'b'), cid, siteName: '旧站', vodName: '乙', vodPic: 'https://img/b.jpg' });
    tick();
    await repo.add({ key: historyKey('cms', 'c'), cid: cid + 1, siteName: 'CMS 站', vodName: '别的配置', vodPic: '' });
  }
  options.beforeMount?.();
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<BootstrapProvider value={bootstrap}>{options.element ?? <CollectScreen />}</BootstrapProvider>);
  });
  return { renderer, cid };
}

describe('CollectScreen', () => {
  // VirtualizedList batches cell updates on a 50 ms timer; fake timers keep it from
  // firing outside act() on a slow host, and unmounting clears it.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    mockNavigate.mockClear();
    mockGoBack.mockClear();
  });
  afterAll(() => setUserDataStore(undefined));

  it('lists the keeps of the active config and opens Detail', async () => {
    const { renderer } = await render({ seed: true });
    expect(cardIds(renderer)).toEqual(['gone@@@b', 'cms@@@a']);
    expect(texts(renderer)).toEqual(expect.arrayContaining(['收藏', '保存在本机', '旧站', 'CMS 站']));
    expect(byTestId(renderer, 'collect-card-gone@@@b').props.width).toBe(224);
    expect(byTestId(renderer, 'collect-card-gone@@@b').props.hasTVPreferredFocus).toBe(true);
    expect(renderer.root.findAll((node) => node.props.testID === 'collect-clear')).toHaveLength(0);

    await act(async () => byTestId(renderer, 'collect-card-gone@@@b').props.onPress());
    expect(mockNavigate).toHaveBeenCalledWith('Detail', {
      siteKey: 'gone',
      vodId: 'b',
      vodName: '乙',
      vodPic: 'https://img/b.jpg',
    });
    await act(async () => renderer.unmount());
  });

  it('removes a keep in edit mode', async () => {
    const { renderer, cid } = await render({ seed: true });
    await act(async () => byTestId(renderer, 'collect-edit').props.onPress());
    await act(async () => byTestId(renderer, 'collect-card-cms@@@a').props.onPress());
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(cardIds(renderer)).toEqual(['gone@@@b']);
    expect(await getKeepRepository().isKept(historyKey('cms', 'a'), cid)).toBe(false);
    expect(await getKeepRepository().isKept(historyKey('cms', 'c'), cid + 1)).toBe(true);
    await act(async () => renderer.unmount());
  });

  it('shows the empty and no-config states', async () => {
    const empty = await render();
    expect(texts(empty.renderer)).toContain('片单是空的。在详情页按「收藏」加入想看的内容。');
    expect(byTestId(empty.renderer, 'collect-edit').props.hasTVPreferredFocus).toBe(true);
    await act(async () => empty.renderer.unmount());

    const none = await render({ saved: false });
    expect(texts(none.renderer)).toEqual(expect.arrayContaining(['收藏', '请先添加配置']));
    await act(async () => none.renderer.unmount());
  });

  it('goes back from the back button', async () => {
    const { renderer } = await render();
    await act(async () => byTestId(renderer, 'collect-back').props.onPress());
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });

  it('shows a load error with retry', async () => {
    const { renderer } = await render({
      seed: true,
      beforeMount: () => void jest.spyOn(getKeepRepository(), 'list').mockRejectedValueOnce(new Error('坏了')),
    });
    expect(texts(renderer)).toContain('加载失败：坏了');
    await act(async () => byTestId(renderer, 'collect-error-retry').props.onPress());
    expect(cardIds(renderer)).toEqual(['gone@@@b', 'cms@@@a']);
    await act(async () => renderer.unmount());
  });

  it('embeds with the count in sync and ends edit mode when empty', async () => {
    const { renderer } = await render({
      seed: true,
      element: (
        <>
          <CollectView embedded />
          <CountProbe />
        </>
      ),
    });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['我的片单', '保存在本机']));
    expect(renderer.root.findAll((node) => node.props.testID === 'collect-back')).toHaveLength(0);
    expect(byTestId(renderer, 'collect-card-gone@@@b').props.hasTVPreferredFocus).toBe(false);
    expect(countOf(renderer)).toBe('2');

    await act(async () => byTestId(renderer, 'collect-edit').props.onPress());
    expect(texts(renderer)).toContain('按卡片删除');
    await act(async () => byTestId(renderer, 'collect-card-gone@@@b').props.onPress());
    expect(countOf(renderer)).toBe('1');
    await act(async () => byTestId(renderer, 'collect-card-cms@@@a').props.onPress());
    expect(countOf(renderer)).toBe('0');
    expect(texts(renderer)).not.toContain('按卡片删除');
    expect(texts(renderer)).toContain('片单是空的。在详情页按「收藏」加入想看的内容。');
    await act(async () => renderer.unmount());
  });
});
