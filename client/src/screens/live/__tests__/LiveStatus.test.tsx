import { ActivityIndicator, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { MemoryStore } from '../../../core/storage';
import { normalizeLive } from '../../../core/types';
import { setUserDataStore } from '../../../core/userData';
import { DETAIL_MAX, LiveStatus, type LiveStatusProps, shortDetail } from '../LiveStatus';

const mockNavigate = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({ useAppNavigation: () => ({ navigate: mockNavigate }) }));

const liveA = normalizeLive({ name: '直播A', url: 'http://a/list.txt' });
const liveB = normalizeLive({ name: '直播B', url: 'http://b/list.txt' });

let renderer: ReactTestRenderer | undefined;

async function render(props: LiveStatusProps) {
  await act(async () => {
    renderer = create(<LiveStatus {...props} />);
  });
  return renderer!;
}

const find = (testID: string) => renderer!.root.findAll((node) => node.props.testID === testID);
const has = (testID: string) => find(testID).length > 0;
const texts = () => renderer!.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));

async function press(testID: string) {
  await act(async () => find(testID)[0]!.props.onPress());
}

beforeEach(() => {
  mockNavigate.mockClear();
  setUserDataStore(new MemoryStore());
});

afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  setUserDataStore(undefined);
});

describe('shortDetail', () => {
  it('keeps the first line only', () => {
    const chain = 'fetch failed: no protocol\n  at java.net.URL.<init>(URL.java:611)\nCaused by: MalformedURLException';
    expect(shortDetail(chain)).toBe('fetch failed: no protocol');
  });

  it('cuts long messages', () => {
    const detail = shortDetail('x'.repeat(300));
    expect(detail).toHaveLength(DETAIL_MAX);
    expect(detail.endsWith('…')).toBe(true);
  });

  it('is empty without a message', () => {
    expect(shortDetail(undefined)).toBe('');
    expect(shortDetail('  ')).toBe('');
  });
});

describe('LiveStatus', () => {
  it('shows the top bar with 直播 active', async () => {
    await render({ kind: 'loading' });
    expect(has('live-loading')).toBe(true);
    const tab = find('top-nav-live')[0]!;
    expect(tab.props.active).toBe(true);
    expect(has('top-nav-search')).toBe(true);
    expect(has('live-nav-control')).toBe(true);
    expect(has('live-nav-settings')).toBe(true);
    expect(renderer!.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(texts()).toContain('正在加载…');
    expect(has('live-loading-retry')).toBe(false);
  });

  it('shows a readable title and the shortened detail', async () => {
    const onRetry = jest.fn();
    await render({
      kind: 'error',
      title: '频道加载失败',
      detail: 'fetch failed\njava.net.MalformedURLException: no protocol:',
      lives: [liveA],
      home: '直播A',
      onRetry,
      onSelectLive: jest.fn(),
    });
    expect(has('live-load-error')).toBe(true);
    expect(texts()).toContain('频道加载失败');
    expect(find('live-load-error-detail')[0]!.props.children).toBe('fetch failed');
    expect(texts().join('\n')).not.toContain('MalformedURLException');
    expect(find('live-load-error-retry')[0]!.props.hasTVPreferredFocus).toBe(true);
    await press('live-load-error-retry');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers 切换直播源 only with more than one source', async () => {
    await render({
      kind: 'error',
      title: '频道加载失败',
      lives: [liveA],
      home: '直播A',
      onRetry: jest.fn(),
      onSelectLive: jest.fn(),
    });
    expect(has('live-load-error-switch')).toBe(false);
  });

  it('switches the live source through the live panel', async () => {
    const onSelectLive = jest.fn();
    await render({
      kind: 'empty',
      title: '暂无频道',
      lives: [liveA, liveB],
      home: '直播A',
      onRetry: jest.fn(),
      onSelectLive,
    });
    expect(has('live-panel')).toBe(false);
    await press('live-empty-switch');
    expect(has('live-panel')).toBe(true);
    await press('live-source-1');
    expect(onSelectLive).toHaveBeenCalledWith(liveB);
    expect(has('live-panel')).toBe(false);
  });

  it('opens Settings from 直播设置', async () => {
    await render({ kind: 'empty', title: '暂无直播源', lives: [], onRetry: jest.fn(), onSelectLive: jest.fn() });
    expect(has('live-empty-retry')).toBe(true);
    expect(has('live-empty-switch')).toBe(false);
    await press('live-empty-settings');
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });
});
