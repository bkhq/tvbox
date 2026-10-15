import { useState } from 'react';
import { FlatList, Image, Pressable, ScrollView, StyleSheet, Text, TVFocusGuideView } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { createKeepRepository } from '../../../core/storage/keep';
import { MemoryStore } from '../../../core/storage/keyValueStore';
import type { Channel, Group } from '../../../core/types';
import { emptyChannel } from '../../../player/live/channel';
import { focus, Tab } from '../../../ui';
import { LiveBrowse } from '../LiveBrowse';
import { toggleFavourite } from '../liveFavourites';
import { DETAIL_MAX, shortDetail } from '../LiveStatus';
import type { LiveChannelRef, LiveSelection } from '../liveModel';
import type { LiveEpg } from '../useLiveEpg';

void [FlatList, Image, Pressable, ScrollView];

const mockNavigate = jest.fn();
jest.mock('../../../navigation/useAppNavigation', () => ({ useAppNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 }),
}));

const channel = (name: string, number: string, urls = [`http://m/${name}`]): Channel => ({
  ...emptyChannel(name),
  number,
  urls,
});
const groups = (): Group[] => [
  { name: '收藏', pass: '', channel: [] },
  { name: '央视', pass: '', channel: [channel('CCTV1', '1', ['http://m/1a', 'http://m/1b']), channel('CCTV2', '2')] },
  { name: '卫视', pass: '', channel: [channel('浙江卫视', '10')] },
];

const now = Date.now();
const epg: LiveEpg = {
  epgFor: (target) =>
    target.name === 'CCTV1'
      ? {
          key: 'CCTV1',
          date: '',
          list: [{ title: '新闻联播', start: '19:00', end: '19:30', startTime: now - 900_000, endTime: now + 900_000 }],
        }
      : undefined,
  logoOf: () => '',
  request: jest.fn(),
};

const onSelect = jest.fn<void, [LiveChannelRef]>();
const onFull = jest.fn();
const onGroupPress = jest.fn<void, [number | undefined]>();

/** Holds groups and selection the way LivePlayer does. */
function Harness({ error }: { error?: string }) {
  const [state, setState] = useState(groups);
  const [selection, setSelection] = useState<LiveSelection>({ group: 1, channel: 0, line: 0 });
  const repo = useState(() => createKeepRepository(new MemoryStore(), () => 1))[0];
  return (
    <LiveBrowse
      groups={state}
      selection={selection}
      epg={epg}
      onGroupPress={onGroupPress}
      onSelect={(ref) => {
        onSelect(ref);
        setSelection({ ...ref, line: 0 });
      }}
      onFull={onFull}
      error={error}
      onToggleFavourite={(target) =>
        void toggleFavourite(state, target, repo).then((result) => setState(result.groups))
      }
    />
  );
}

async function render(error?: string): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Harness error={error} />);
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  return renderer;
}

const find = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => node.props.testID === testID)[0];
const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const groupRows = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => typeof node.props.testID === 'string' && node.props.testID.startsWith('live-browse-group-'))
    .filter((node) => node.props.accessibilityLabel)
    .map((node) => node.props.accessibilityLabel as string)
    .filter((label, index, all) => all.indexOf(label) === index);
// ChannelCard is memoised; its props sit on the inner component.
const cards = (renderer: ReactTestRenderer) =>
  renderer.root
    .findAll((node) => node.props.name !== undefined && /^live-browse-card-\d+$/.test(node.props.testID ?? ''))
    .map((card) => [card.props.name, !!card.props.playing, !!card.props.favourite])
    .filter((card, index, all) => all.findIndex((other) => other[0] === card[0]) === index);

async function press(
  renderer: ReactTestRenderer,
  testID: string,
  prop: 'onPress' | 'onLongPress' | 'onFocus' = 'onPress',
) {
  await act(async () => {
    find(renderer, testID)!.props[prop]();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('LiveBrowse', () => {
  it('renders the nav with 直播 active, phone / settings icons and no account button', async () => {
    const renderer = await render();
    const tabs = renderer.root.findAllByType(Tab).map((tab) => [tab.props.label, !!tab.props.active]);
    expect(tabs).toContainEqual(['直播', true]);
    expect(tabs.filter(([, active]) => active)).toHaveLength(1);
    expect(texts(renderer)).not.toContain('切换账户');
    expect(renderer.root.findAll((node) => node.props.name === 'user')).toHaveLength(0);

    // The 52 px outlined top-bar buttons.
    expect(find(renderer, 'live-nav-control')!.props.variant).toBe('outline');
    // 设置 is a tab, not a top-bar button.
    expect(find(renderer, 'live-nav-settings')).toBeUndefined();
    await press(renderer, 'top-nav-search');
    await press(renderer, 'live-nav-control');
    await press(renderer, 'top-nav-profile');
    expect(mockNavigate.mock.calls).toEqual([['Search'], ['Control'], ['Settings']]);
    await act(async () => renderer.unmount());
  });

  it('lists the groups with counts and shows the current channel with its programme', async () => {
    const renderer = await render();
    // 收藏 is listed only once it has channels.
    expect(groupRows(renderer)).toEqual(['全部 3', '央视 2', '卫视 1']);
    expect(find(renderer, 'live-browse-number')!.props.children).toBe('01');
    expect(find(renderer, 'live-browse-name')!.props.children).toBe('CCTV1');
    expect(texts(renderer)).toContain('线路 1/2');
    expect(find(renderer, 'live-browse-programme')!.props.children).toBe('新闻联播');
    expect(texts(renderer)).toEqual(expect.arrayContaining(['19:00', '19:30']));
    expect(find(renderer, 'live-browse-progress')!.props.style).toContainEqual({ width: '50%' });
    expect(cards(renderer)).toEqual([
      ['CCTV1', true, false],
      ['CCTV2', false, false],
      ['浙江卫视', false, false],
    ]);
    await act(async () => renderer.unmount());
  });

  it('changes the card row on group focus / press without changing the channel', async () => {
    const renderer = await render();
    await press(renderer, 'live-browse-group-group-2', 'onFocus');
    expect(cards(renderer)).toEqual([['浙江卫视', false, false]]);
    await press(renderer, 'live-browse-group-group-1');
    expect(cards(renderer).map(([name]) => name)).toEqual(['CCTV1', 'CCTV2']);
    expect(onGroupPress).toHaveBeenLastCalledWith(1);
    await press(renderer, 'live-browse-group-all');
    expect(onGroupPress).toHaveBeenLastCalledWith(undefined);
    expect(onSelect).not.toHaveBeenCalled();
    expect(find(renderer, 'live-browse-name')!.props.children).toBe('CCTV1');
    await act(async () => renderer.unmount());
  });

  it('gives the playing card initial focus only, so group focus is not pulled into the row', async () => {
    const renderer = await render();
    const preferred = () =>
      renderer.root
        .findAll((node) => node.props.name !== undefined && /^live-browse-card-\d+$/.test(node.props.testID ?? ''))
        .filter((node) => node.props.hasTVPreferredFocus)
        .map((node) => node.props.name as string);
    expect(preferred()).toContain('CCTV1');

    await press(renderer, 'live-browse-group-group-2', 'onFocus');
    await press(renderer, 'live-browse-group-group-1', 'onFocus');
    expect(cards(renderer).map(([name]) => name)).toEqual(['CCTV1', 'CCTV2']);
    expect(preferred()).toEqual([]);
    await act(async () => renderer.unmount());
  });

  it('clips the scrolled card row so it does not draw over the group column', async () => {
    const renderer = await render();
    const style = [find(renderer, 'live-browse-cards')!.props.style].flat();
    expect(style).not.toContainEqual(expect.objectContaining({ overflow: 'visible' }));
    await act(async () => renderer.unmount());
  });

  it('leaves a focus bleed around the group rows and offsets the column back into place', async () => {
    const renderer = await render();
    const list = renderer.root.findAllByType(ScrollView)[0]!;
    expect(StyleSheet.flatten(list.props.contentContainerStyle)).toMatchObject({ padding: focus.bleed });
    const guide = renderer.root.findAllByType(TVFocusGuideView).find((node) => node.findAllByType(ScrollView)[0] === list)!;
    const column = StyleSheet.flatten(guide.props.style);
    expect(column).toMatchObject({ width: 200 + 2 * focus.bleed, margin: -focus.bleed });
    await act(async () => renderer.unmount());
  });

  it('plays a card on OK, enters full mode on the playing card and from 全屏观看', async () => {
    const renderer = await render();
    await press(renderer, 'live-browse-group-group-2');
    await press(renderer, 'live-browse-card-0');
    expect(onSelect).toHaveBeenCalledWith({ group: 2, channel: 0 });
    expect(onFull).not.toHaveBeenCalled();
    expect(find(renderer, 'live-browse-name')!.props.children).toBe('浙江卫视');
    // The row stays on the picked group.
    expect(cards(renderer)).toEqual([['浙江卫视', true, false]]);

    await press(renderer, 'live-browse-card-0');
    expect(onFull).toHaveBeenCalledTimes(1);
    await press(renderer, 'live-browse-full');
    expect(onFull).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
  });

  it('toggles the favourite: heart, card mark and the 收藏 count', async () => {
    const renderer = await render();
    const heart = () =>
      renderer.root.findAll((node) => node.props.name === 'heart' || node.props.name === 'heartFilled')[0]!;
    expect(heart().props.name).toBe('heart');

    await press(renderer, 'live-browse-favourite');
    expect(heart().props.name).toBe('heartFilled');
    expect(groupRows(renderer)).toEqual(['全部 3', '收藏 1', '央视 2', '卫视 1']);
    expect(cards(renderer)[0]).toEqual(['CCTV1', true, true]);

    // Long press on a card toggles that channel.
    await press(renderer, 'live-browse-card-1', 'onLongPress');
    expect(groupRows(renderer)).toContain('收藏 2');
    expect(cards(renderer)[1]).toEqual(['CCTV2', false, true]);

    await press(renderer, 'live-browse-favourite');
    expect(heart().props.name).toBe('heart');
    expect(groupRows(renderer)).toContain('收藏 1');
    await act(async () => renderer.unmount());
  });

  it('shows a non-focusable error block over the preview with the shortened detail', async () => {
    const fine = await render();
    expect(find(fine, 'live-browse-error')).toBeUndefined();
    await act(async () => fine.unmount());

    const detail = `java.io.IOException: ${'x'.repeat(200)}\n\tat com.example.Foo(Foo.java:1)`;
    const renderer = await render(detail);
    const block = find(renderer, 'live-browse-error')!;
    expect(texts(renderer)).toContain('CCTV1 播放失败');
    const shown = [find(renderer, 'live-browse-error-detail')!.props.children].flat().join('');
    expect(shown).toBe(shortDetail(detail));
    expect(shown.length).toBeLessThanOrEqual(DETAIL_MAX);
    expect(shown).not.toContain('Foo.java');
    const wrappers = renderer.root.findAll(
      (node) => node.props.pointerEvents === 'none' && node.findAll((inner) => inner === block).length > 0,
    );
    expect(wrappers.length).toBeGreaterThan(0);
    expect(block.findAll((node) => node.props.focusable || typeof node.props.onPress === 'function')).toHaveLength(0);
    await act(async () => renderer.unmount());

    const bare = await render('');
    expect(texts(bare)).toContain('CCTV1 播放失败');
    expect(find(bare, 'live-browse-error-detail')).toBeUndefined();
    await act(async () => bare.unmount());
  });
});
