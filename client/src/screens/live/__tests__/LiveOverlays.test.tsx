import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { appSettings } from '../../../core/settings';
import { MemoryStore } from '../../../core/storage';
import { type Group, normalizeLive } from '../../../core/types';
import { setUserDataStore } from '../../../core/userData';
import type { Epg } from '../../../player/live';
import { Button, Chip } from '../../../ui';
import { emptyChannel } from '../../../player/live/channel';
import { ChannelList } from '../ChannelList';
import { InfoBar } from '../InfoBar';
import { LivePanel, PassPrompt } from '../LivePanel';
import type { LiveEpg } from '../useLiveEpg';

const channel = (name: string, number: string, urls: string[]) => ({ ...emptyChannel(name), number, urls });

const now = Date.now();
const epg: Epg = {
  key: 'CCTV1',
  date: '',
  list: [
    { title: '新闻联播', start: '19:00', end: '19:30', startTime: now - 60_000, endTime: now + 60_000 },
    { title: '焦点访谈', start: '19:30', end: '19:45', startTime: now + 60_000, endTime: now + 120_000 },
  ],
};

const groups = (): Group[] => [
  { name: '收藏', pass: '', channel: [] },
  {
    name: '央视',
    pass: '',
    channel: [channel('CCTV1', '001', ['http://m/1a', 'http://m/1b']), channel('CCTV2', '002', ['http://m/2'])],
  },
  { name: '卫视', pass: '', channel: [channel('浙江卫视', '010', ['http://m/zj'])] },
];

const liveEpg: LiveEpg = {
  epgFor: (item) => (item.name === 'CCTV1' ? epg : undefined),
  logoOf: () => '',
  request: jest.fn(),
};

let renderer: ReactTestRenderer;

async function render(element: React.ReactElement) {
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

const byTestId = (testID: string) => renderer.root.findAll((node) => node.props.testID === testID)[0];
const button = (testID: string) =>
  renderer.root.findAll((node) => node.type === Button && node.props.testID === testID)[0]!;
const has = (testID: string) => byTestId(testID) !== undefined;
const texts = () => renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));

async function press(testID: string) {
  await act(async () => byTestId(testID)!.props.onPress());
}

beforeEach(() => setUserDataStore(new MemoryStore()));

afterEach(async () => {
  await act(async () => renderer?.unmount());
  setUserDataStore(undefined);
});

describe('InfoBar', () => {
  it('shows number, name, line badge, programme with progress and the next programme', async () => {
    await render(<InfoBar channel={channel('CCTV1', '001', ['a', 'b'])} line={1} logo="" epg={epg} />);
    const shown = texts();
    expect(shown).toEqual(expect.arrayContaining(['01', 'CCTV1', '线路 2/2']));
    expect(has('live-info-line')).toBe(true);
    expect(byTestId('live-info-current')!.props.children).toBe('当前：19:00 ~ 19:30  新闻联播');
    expect(byTestId('live-info-next')!.props.children).toBe('下一个：19:30 ~ 19:45  焦点访谈');
    expect(StyleSheet.flatten(byTestId('live-info-progress')!.props.style).width).toBe('50%');
  });

  it('hides the line badge and programme rows for a single-line channel without EPG', async () => {
    await render(<InfoBar channel={channel('CCTV2', '', ['a'])} line={0} logo="http://logo/2.png" />);
    expect(texts()).toContain('CCTV2');
    expect(has('live-info-logo')).toBe(true);
    expect(has('live-info-line')).toBe(false);
    expect(has('live-info-current')).toBe(false);
    expect(has('live-info-next')).toBe(false);
    expect(has('live-info-progress')).toBe(false);
  });
});

describe('ChannelList', () => {
  const props = () => ({
    groups: groups(),
    selection: { group: 1, channel: 0, line: 0 },
    epg: liveEpg,
    isTV: true,
    onGroupPress: jest.fn(),
    onSelect: jest.fn(),
    onClose: jest.fn(),
    onMenu: jest.fn(),
  });

  it('lists groups with counts, marks the playing channel and its programme', async () => {
    await render(<ChannelList {...props()} />);
    const shown = texts();
    expect(shown).toEqual(expect.arrayContaining(['收藏', '0', '央视', '2', '卫视', '1']));
    expect(shown).toEqual(expect.arrayContaining(['001', 'CCTV1', '新闻联播', '002', 'CCTV2']));
    expect(has('live-channel-0-playing')).toBe(true);
    expect(has('live-channel-1-playing')).toBe(false);
    expect(shown).toContain('正在看');
    expect(byTestId('live-group-1')!.props.selected).toBe(true);
    expect(byTestId('live-group-2')!.props.selected).toBe(false);
    // TV programme guide of the focused channel.
    expect(shown).toEqual(expect.arrayContaining(['19:00 ~ 19:30', '焦点访谈']));
    expect(has('live-back')).toBe(false);
  });

  it('switches groups and reports group presses, selection, menu, back and dismiss', async () => {
    const callbacks = { ...props(), onBack: jest.fn() };
    await render(<ChannelList {...callbacks} />);
    await press('live-group-2');
    expect(callbacks.onGroupPress).toHaveBeenCalledWith(2);
    expect(texts()).toContain('浙江卫视');
    expect(has('live-channel-0-playing')).toBe(false);
    await press('live-channel-0');
    expect(callbacks.onSelect).toHaveBeenCalledWith(2, 0);
    await press('live-menu');
    expect(callbacks.onMenu).toHaveBeenCalled();
    await press('live-back');
    expect(callbacks.onBack).toHaveBeenCalled();
    await press('live-list-dismiss');
    expect(callbacks.onClose).toHaveBeenCalled();
  });

  it('shows empty groups and no guide on phones', async () => {
    await render(<ChannelList {...props()} selection={{ group: 0, channel: 0, line: 0 }} isTV={false} />);
    expect(texts()).toContain('暂无频道');
    expect(has('live-epg')).toBe(false);
  });
});

describe('LivePanel and PassPrompt', () => {
  it('selects a source, toggles a setting and closes', async () => {
    const onSelect = jest.fn();
    const onClose = jest.fn();
    const lives = [
      normalizeLive({ name: '直播A', url: 'http://a' }),
      normalizeLive({ name: '直播B', url: 'http://b' }),
    ];
    await act(async () => appSettings.set('invert', false));
    await render(<LivePanel lives={lives} home="直播A" onSelect={onSelect} onClose={onClose} />);
    // The current source and the switches that are on use the accent fill, never the focus look.
    expect(button('live-source-0').props.variant).toBe('primary');
    expect(button('live-source-1').props.variant).toBe('secondary');
    expect(renderer.root.findAllByType(Chip)).toHaveLength(0);
    await press('live-source-1');
    expect(onSelect).toHaveBeenCalledWith(lives[1]);
    expect(texts()).toContain('换台反转：关');
    expect(button('live-setting-invert').props.variant).toBe('secondary');
    await press('live-setting-invert');
    expect(texts()).toContain('换台反转：开');
    expect(button('live-setting-invert').props.variant).toBe('primary');
    await press('live-panel-close');
    expect(onClose).toHaveBeenCalled();
  });

  it('submits the typed password', async () => {
    const onSubmit = jest.fn();
    const onClose = jest.fn();
    await render(<PassPrompt onSubmit={onSubmit} onClose={onClose} />);
    await act(async () => byTestId('live-pass-input')!.props.onChangeText('8888'));
    await press('live-pass-ok');
    expect(onSubmit).toHaveBeenCalledWith('8888');
    await act(async () => byTestId('live-pass-input')!.props.onSubmitEditing());
    expect(onSubmit).toHaveBeenCalledTimes(2);
    await press('live-panel-close');
    expect(onClose).toHaveBeenCalled();
  });
});
