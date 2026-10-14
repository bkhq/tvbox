import {
  Animated,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TVFocusGuideView,
  View,
} from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Flag } from '../../../core/types';
import type { EngineFactory, Track } from '../../../player/engine/types';
import { Button, Chip, focus } from '../../../ui';
import {
  AudioPanel,
  EnginePanel,
  EpisodePanel,
  LinePanel,
  Panel,
  SettingsPanel,
  SpeedPanel,
  SubtitlePanel,
} from '../Panels';

void [Animated, BackHandler, Modal, Pressable, ScrollView, Text, TextInput, View];

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

const byTestId = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => node.props.testID === testID)[0]!;

/** The ui Button/Chip rendered for a testID (not the local wrapper around it). */
const control = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => (node.type === Button || node.type === Chip) && node.props.testID === testID)[0]!;

const ids = (renderer: ReactTestRenderer, prefix: string) =>
  renderer.root
    .findAll((node) => (node.type === Button || node.type === Chip) && String(node.props.testID).startsWith(prefix))
    .map((node) => node.props.testID as string);

const flags = ['线路一', '线路二', '线路三'].map((flag) => ({ flag, episodes: [] })) as unknown as Flag[];

const engine = (kind: 'video' | 'mpv', label: string, available = true) =>
  ({ kind, label, isAvailable: () => available, Component: () => null }) as unknown as EngineFactory;
const engines = [engine('video', '系统播放器'), engine('mpv', 'MPV', false)];

describe('Panel', () => {
  it('renders the new titles in a sheet that closes on back and on 关闭', async () => {
    const onClose = jest.fn();
    const renderer = await render(
      <Panel kind="line" onClose={onClose}>
        <Text>x</Text>
      </Panel>,
    );
    expect(byTestId(renderer, 'player-panel-line')).toBeTruthy();
    expect(renderer.root.findAllByType(Text).map((node) => node.props.children)).toContain('画质');
    await act(async () => renderer.root.findByType(Modal).props.onRequestClose());
    await act(async () => byTestId(renderer, 'player-panel-close').props.onPress());
    expect(onClose).toHaveBeenCalledTimes(2);

    await act(async () => renderer.update(<Panel kind="settings" onClose={onClose}>{null}</Panel>));
    expect(byTestId(renderer, 'player-panel-settings')).toBeTruthy();
    expect(renderer.root.findAllByType(Text).map((node) => node.props.children)).toContain('设置');
  });

  it('traps D-pad focus on every side of the sheet, close button included', async () => {
    const renderer = await render(
      <Panel kind="episodes" onClose={jest.fn()}>
        <Text>x</Text>
      </Panel>,
    );
    const trap = byTestId(renderer, 'player-panel-episodes').findByType(TVFocusGuideView);
    expect(trap.props).toMatchObject({
      trapFocusUp: true,
      trapFocusDown: true,
      trapFocusLeft: true,
      trapFocusRight: true,
    });
    expect(trap.findAll((node) => node.props.testID === 'player-panel-close').length).toBeGreaterThan(0);
  });
});

describe('chip rows', () => {
  it('mark the current speed with the accent fill, not the focus look', async () => {
    const onSelect = jest.fn();
    const renderer = await render(<SpeedPanel speed={1.5} onSelect={onSelect} />);
    const current = control(renderer, 'player-speed-1.5');
    expect(current.props).toMatchObject({ variant: 'primary', hasTVPreferredFocus: true });
    expect(control(renderer, 'player-speed-1').props.variant).toBe('secondary');
    expect(renderer.root.findAllByType(Chip)).toHaveLength(0);
    await act(async () => control(renderer, 'player-speed-2').props.onPress());
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it('mark the shown episode line with the accent fill and switch lines', async () => {
    const lines = [
      { flag: '线路一', episodes: [{ name: '第1集', url: 'a' }] },
      { flag: '线路二', episodes: [{ name: '第1集', url: 'b' }, { name: '第2集', url: 'c' }] },
    ] as unknown as Flag[];
    const renderer = await render(<EpisodePanel flags={lines} flagIndex={0} episodeIndex={0} onSelect={jest.fn()} />);
    expect(control(renderer, 'player-flag-0').props.variant).toBe('primary');
    expect(control(renderer, 'player-flag-1').props.variant).toBe('secondary');
    await act(async () => control(renderer, 'player-flag-1').props.onPress());
    expect(control(renderer, 'player-flag-1').props.variant).toBe('primary');
    expect(ids(renderer, 'player-episode-')).toEqual(['player-episode-0', 'player-episode-1']);
  });
});

describe('LinePanel', () => {
  it('lists one option per line, selects the current one and calls back', async () => {
    const onSelect = jest.fn();
    const renderer = await render(<LinePanel flags={flags} flagIndex={1} onSelect={onSelect} />);
    expect(ids(renderer, 'player-line-')).toEqual(['player-line-0', 'player-line-1', 'player-line-2']);
    expect(control(renderer, 'player-line-0').props.title).toBe('线路一');
    expect(control(renderer, 'player-line-1').props).toMatchObject({ variant: 'primary', hasTVPreferredFocus: true });
    expect(control(renderer, 'player-line-2').props.variant).toBe('secondary');

    await act(async () => control(renderer, 'player-line-2').props.onPress());
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});

const tracks: Track[] = [
  { id: 'a', label: '国语', language: 'zh' },
  { id: 'b', label: '', language: 'und' },
  { id: 'c', label: 'eng' },
  { id: 'd', label: '', language: 'zh-Hant' },
];

describe('track panels', () => {
  it('labels audio options by name or language, else 音轨 N', async () => {
    const renderer = await render(<AudioPanel tracks={tracks} onSelect={jest.fn()} />);
    expect(['a', 'b', 'c', 'd'].map((id) => control(renderer, `player-audio-${id}`).props.title)).toEqual([
      '国语',
      '音轨 2',
      '英语',
      '繁体中文',
    ]);
  });

  it('labels subtitle options by name or language, else 字幕 N', async () => {
    const renderer = await render(
      <SubtitlePanel tracks={tracks} selected={null} external={[]} onSelect={jest.fn()} onAdd={jest.fn()} />,
    );
    expect(['a', 'b', 'c', 'd'].map((id) => control(renderer, `player-subtitle-${id}`).props.title)).toEqual([
      '国语',
      '字幕 2',
      '英语',
      '繁体中文',
    ]);
  });

  it('leaves room for the focus zoom and ring of a full-width option inside the scrolled list', async () => {
    const renderer = await render(<SubtitlePanel tracks={tracks} external={[]} onSelect={jest.fn()} onAdd={jest.fn()} />);
    const list = renderer.root.findAllByType(ScrollView)[0]!;
    const content = StyleSheet.flatten(list.props.contentContainerStyle);
    const outer = StyleSheet.flatten(list.props.style);
    const option = StyleSheet.flatten(control(renderer, 'player-subtitle-off').props.style);
    // A 1.08 zoom of a ~600 wide row grows ~24 per side; the ring adds 8 more.
    expect(content.paddingHorizontal).toBeGreaterThanOrEqual((content.paddingVertical as number) * 2);
    expect(content.paddingVertical).toBeGreaterThan(0);
    expect(outer.marginHorizontal).toBe(-(content.paddingHorizontal as number));
    // The gap between rows keeps the next row off the focused row's ring.
    expect(option.marginBottom).toBeGreaterThanOrEqual(content.paddingVertical as number);
  });

  it('shows a focus border on the subtitle URL input without a lineHeight or vertical padding', async () => {
    const renderer = await render(<SubtitlePanel tracks={[]} external={[]} onSelect={jest.fn()} onAdd={jest.fn()} />);
    const input = () => renderer.root.findByType(TextInput);
    const style = () => StyleSheet.flatten(input().props.style);
    expect(style().borderColor).toBe('transparent');
    await act(async () => input().props.onFocus());
    expect(style()).toMatchObject({ borderColor: focus.borderColor, paddingVertical: 0 });
    expect(style().borderWidth).toBeGreaterThan(0);
    expect(style().lineHeight).toBeUndefined();
    await act(async () => input().props.onBlur());
    expect(style().borderColor).toBe('transparent');
  });
});

describe('SettingsPanel', () => {
  it('shows engine and scale sections and calls back for each', async () => {
    const onSelectEngine = jest.fn();
    const onSelectScale = jest.fn();
    const renderer = await render(
      <SettingsPanel
        engines={engines}
        preference="video"
        active={engines[0]}
        scale={3}
        onSelectEngine={onSelectEngine}
        onSelectScale={onSelectScale}
      />,
    );
    const labels = renderer.root.findAllByType(Text).map((node) => node.props.children);
    expect(labels).toEqual(expect.arrayContaining(['播放器', '画面比例', '当前：系统播放器']));

    expect(ids(renderer, 'player-settings-engine-')).toEqual([
      'player-settings-engine-auto',
      'player-settings-engine-video',
      'player-settings-engine-mpv',
    ]);
    expect(control(renderer, 'player-settings-engine-video').props.variant).toBe('primary');
    expect(control(renderer, 'player-settings-engine-auto').props.variant).toBe('secondary');
    expect(control(renderer, 'player-settings-engine-mpv').props.disabled).toBe(true);

    const scales = renderer.root.findAll(
      (node) => node.type === Button && String(node.props.testID).startsWith('player-settings-scale-'),
    );
    expect(scales.map((node) => [node.props.testID, node.props.title, node.props.variant])).toEqual([
      ['player-settings-scale-0', '原始', 'secondary'],
      ['player-settings-scale-1', '16:9', 'secondary'],
      ['player-settings-scale-2', '4:3', 'secondary'],
      ['player-settings-scale-3', '填充', 'primary'],
      ['player-settings-scale-4', '裁剪', 'secondary'],
    ]);

    // Each section is a focus guide, so DOWN from the last engine lands on the first scale (原始), UP goes back.
    const sections = renderer.root.findAllByType(TVFocusGuideView);
    expect(sections).toHaveLength(2);
    expect(sections.every((node) => node.props.autoFocus)).toBe(true);
    const inSection = (index: number) =>
      sections[index]!.findAll((node) => node.type === Button).map((node) => node.props.testID as string);
    expect(inSection(0)).toEqual([
      'player-settings-engine-auto',
      'player-settings-engine-video',
      'player-settings-engine-mpv',
    ]);
    expect(inSection(1)[0]).toBe('player-settings-scale-0');

    await act(async () => control(renderer, 'player-settings-engine-auto').props.onPress());
    await act(async () => control(renderer, 'player-settings-scale-4').props.onPress());
    expect(onSelectEngine).toHaveBeenCalledWith('auto');
    expect(onSelectScale).toHaveBeenCalledWith(4);
  });
});

describe('EnginePanel', () => {
  it('keeps the player-engine testIDs', async () => {
    const onSelect = jest.fn();
    const renderer = await render(<EnginePanel engines={engines} preference="auto" onSelect={onSelect} />);
    expect(ids(renderer, 'player-engine-')).toEqual(['player-engine-auto', 'player-engine-video', 'player-engine-mpv']);
    await act(async () => control(renderer, 'player-engine-video').props.onPress());
    expect(onSelect).toHaveBeenCalledWith('video');
  });
});
