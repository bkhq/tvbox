import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { color, focus } from '../tokens';
import { WideCard } from '../WideCard';

// Design px map 1:1 onto a 1920 wide window.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 }),
}));

void [Animated, Image, Pressable, Text, View];

const springSpy = jest.spyOn(Animated, 'spring');

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

function host(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'card')[0]!;
}

const box = (renderer: ReactTestRenderer) => StyleSheet.flatten(renderer.root.findByType(Animated.View).props.style);
const texts = (renderer: ReactTestRenderer) => renderer.root.findAllByType(Text).map((n) => n.props.children);
const progress = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.type === View && n.props.testID === 'card-progress');
const fill = (renderer: ReactTestRenderer) =>
  StyleSheet.flatten(
    progress(renderer)[0]!.findAll((n) => n.type === View && n !== progress(renderer)[0])[0]!.props.style,
  );
const fillWidth = (renderer: ReactTestRenderer) => fill(renderer).width;
const focusBorder = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.type === View && StyleSheet.flatten(n.props.style)?.borderColor === focus.borderColor);

describe('WideCard', () => {
  it('renders a 352x198 still with subtitle inside and title below', async () => {
    const renderer = await render(<WideCard testID="card" title="长安" subtitle="第 5 集 · 剩余 18 分钟" />);
    expect(box(renderer)).toMatchObject({ width: 352, height: 198 });
    expect(texts(renderer)).toEqual(['第 5 集 · 剩余 18 分钟', '长安']);
    expect(progress(renderer)).toHaveLength(0);
  });

  it('keeps 16:9 for a width override and loads the still', async () => {
    const renderer = await render(<WideCard title="长安" width={320} image="http://a/s.jpg" />);
    expect(box(renderer)).toMatchObject({ width: 320, height: 180 });
    expect(renderer.root.findByType(Image).props.source).toEqual({ uri: 'http://a/s.jpg' });
    expect(texts(renderer)).toEqual(['长安']);
  });

  it('draws the progress bar proportionally, clamped to 0..1', async () => {
    const half = await render(<WideCard testID="card" title="长安" progress={0.4} />);
    expect(fillWidth(half)).toBe('40%');
    expect(fill(half).backgroundColor).toBe(color.accent);

    expect(fillWidth(await render(<WideCard testID="card" title="长安" progress={1.7} />))).toBe('100%');
    expect(fillWidth(await render(<WideCard testID="card" title="长安" progress={-0.2} />))).toBe('0%');
    expect(fillWidth(await render(<WideCard testID="card" title="长安" progress={Number.NaN} />))).toBe('0%');
  });

  it('draws the focus border and springs to the focus scale', async () => {
    const renderer = await render(<WideCard testID="card" title="长安" />);
    expect(focusBorder(renderer)).toHaveLength(0);

    await act(async () => host(renderer).props.onFocus({}));
    expect(focusBorder(renderer)).toHaveLength(1);
    expect(springSpy.mock.calls.at(-1)![1]).toMatchObject({ toValue: focus.scale });

    await act(async () => host(renderer).props.onBlur({}));
    expect(focusBorder(renderer)).toHaveLength(0);
  });

  it('fires onPress', async () => {
    const onPress = jest.fn();
    const renderer = await render(<WideCard testID="card" title="长安" onPress={onPress} />);
    await act(async () => host(renderer).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
