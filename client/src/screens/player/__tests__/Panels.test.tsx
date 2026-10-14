import { Animated, BackHandler, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import type { Flag } from '../../../core/types';
import type { EngineFactory } from '../../../player/engine/types';
import { Button, Chip } from '../../../ui';
import { EnginePanel, LinePanel, Panel, SettingsPanel } from '../Panels';

void [Animated, BackHandler, Modal, Pressable, ScrollView, Text, View];

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
      (node) => node.type === Chip && String(node.props.testID).startsWith('player-settings-scale-'),
    );
    expect(scales.map((node) => [node.props.testID, node.props.label, !!node.props.selected])).toEqual([
      ['player-settings-scale-0', '原始', false],
      ['player-settings-scale-1', '16:9', false],
      ['player-settings-scale-2', '4:3', false],
      ['player-settings-scale-3', '填充', true],
      ['player-settings-scale-4', '裁剪', false],
    ]);

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
