import { StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Controls, type ControlsProps } from '../Controls';
import { episodeLabel } from '../format';

const mounted: ReactTestRenderer[] = [];

afterEach(() => {
  act(() => mounted.splice(0).forEach((renderer) => renderer.unmount()));
});

function renderControls(overrides: Partial<ControlsProps> = {}) {
  const props: ControlsProps = {
    title: '极地之光',
    episodeLabel: episodeLabel(1, 'xxx'),
    position: 60_000,
    duration: 600_000,
    buffered: 120_000,
    playing: true,
    speed: 1,
    hasEpisodes: true,
    hasPrev: true,
    hasNext: true,
    lineName: 'a',
    hasLines: false,
    onActivity: jest.fn(),
    onBack: jest.fn(),
    onToggle: jest.fn(),
    onPrev: jest.fn(),
    onNext: jest.fn(),
    onSeek: jest.fn(),
    onPanel: jest.fn(),
    ...overrides,
  };
  let renderer!: ReactTestRenderer;
  act(() => {
    renderer = create(<Controls {...props} />);
  });
  mounted.push(renderer);
  return { renderer, props };
}

const has = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => node.props.testID === testID).length > 0;
const byTestId = (renderer: ReactTestRenderer, testID: string) =>
  renderer.root.findAll((node) => node.props.testID === testID)[0]!;
const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));
const width = (renderer: ReactTestRenderer, testID: string) => StyleSheet.flatten(byTestId(renderer, testID).props.style).width;

function press(renderer: ReactTestRenderer, testID: string) {
  act(() => byTestId(renderer, testID).props.onPress());
}

describe('episodeLabel', () => {
  it('prefixes the episode number unless the name already is one', () => {
    expect(episodeLabel(1, 'xxx')).toBe('第 2 集·xxx');
    expect(episodeLabel(2, '第3集')).toBe('第3集');
  });
});

describe('Controls', () => {
  it('renders the title and the episode line', () => {
    const { renderer } = renderControls();
    expect(texts(renderer)).toEqual(expect.arrayContaining(['极地之光', '第 2 集·xxx']));
    const { renderer: noEpisode } = renderControls({ episodeLabel: undefined });
    expect(texts(noEpisode).some((value) => value.startsWith('第'))).toBe(false);
  });

  it('shows the quality badge only when it is known', () => {
    expect(has(renderControls().renderer, 'player-quality')).toBe(false);
    const { renderer } = renderControls({ quality: '1080P' });
    expect(has(renderer, 'player-quality')).toBe(true);
    expect(texts(renderer)).toContain('1080P');
  });

  it('draws the buffered and played widths', () => {
    const { renderer } = renderControls();
    expect(width(renderer, 'player-played')).toBe('10%');
    expect(width(renderer, 'player-buffered')).toBe('20%');
    expect(texts(renderer)).toEqual(expect.arrayContaining(['01:00', '10:00']));
  });

  it('shows the seek preview in place of the position', () => {
    const { renderer } = renderControls({ seekTarget: 300_000 });
    expect(byTestId(renderer, 'player-seek-target').props.children).toBe('05:00');
    expect(width(renderer, 'player-played')).toBe('50%');
  });

  it('shows 画质 only with several lines and opens the line panel', () => {
    expect(has(renderControls().renderer, 'player-line')).toBe(false);
    const { renderer, props } = renderControls({ hasLines: true });
    expect(texts(renderer)).toContain('画质·a');
    press(renderer, 'player-line');
    expect(props.onPanel).toHaveBeenCalledWith('line');
  });

  it('hides 选集 and prev / next without episodes', () => {
    const { renderer } = renderControls({ hasEpisodes: false });
    for (const id of ['player-episodes', 'player-prev', 'player-next']) expect(has(renderer, id)).toBe(false);
    const { renderer: last } = renderControls({ hasNext: false });
    expect(byTestId(last, 'player-next').props.disabled).toBe(true);
  });

  it('seeks ±10 s clamped to the duration', () => {
    const { renderer, props } = renderControls({ position: 595_000 });
    press(renderer, 'player-forward');
    expect(props.onSeek).toHaveBeenLastCalledWith(600_000);
    const start = renderControls({ position: 4_000 });
    press(start.renderer, 'player-rewind');
    expect(start.props.onSeek).toHaveBeenLastCalledWith(0);
    expect(start.props.onActivity).toHaveBeenCalled();
  });

  it('labels and opens the panels', () => {
    const { renderer, props } = renderControls({ speed: 1.5, subtitleName: '中文', audioName: '国语' });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['1.5x', '字幕·中文', '音轨·国语']));
    press(renderer, 'player-engine');
    expect(props.onPanel).toHaveBeenLastCalledWith('settings');
    press(renderer, 'player-episodes');
    expect(props.onPanel).toHaveBeenLastCalledWith('episodes');
    press(renderer, 'player-back');
    expect(props.onBack).toHaveBeenCalled();
  });

  it('drops the track suffix when no label is known', () => {
    const { renderer } = renderControls({ subtitleName: undefined, audioName: undefined });
    expect(texts(renderer)).toEqual(expect.arrayContaining(['字幕', '音轨']));
    expect(texts(renderer).some((value) => value.includes('und'))).toBe(false);
  });
});
