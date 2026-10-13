import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Badge } from '../Badge';
import { PosterCard } from '../PosterCard';
import { color, focus } from '../tokens';

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
const focusBorder = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.type === View && StyleSheet.flatten(n.props.style)?.borderColor === focus.borderColor);

describe('PosterCard', () => {
  it('renders a 224x336 poster with title and meta', async () => {
    const renderer = await render(<PosterCard testID="card" title="长安" meta="2024 · 8.6" />);
    expect(box(renderer)).toMatchObject({ width: 224, height: 336 });
    expect(texts(renderer)).toEqual(['长安', '2024 · 8.6']);
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
  });

  it('keeps 2:3 for a width override and loads the poster with its headers', async () => {
    const renderer = await render(<PosterCard title="长安" width={180} poster="http://a/p.jpg@Referer=http://r/" />);
    expect(box(renderer)).toMatchObject({ width: 180, height: 270 });
    expect(renderer.root.findByType(Image).props.source).toEqual([
      { uri: 'http://a/p.jpg', headers: { Referer: 'http://r/' } },
    ]);
  });

  it('shows the badge only when given', async () => {
    const plain = await render(<PosterCard title="长安" />);
    expect(plain.root.findAllByType(Badge)).toHaveLength(0);

    const tagged = await render(<PosterCard title="长安" badge="更新至12集" />);
    expect(tagged.root.findByType(Badge).props).toMatchObject({ label: '更新至12集', variant: 'accent' });

    const outline = await render(<PosterCard title="长安" badge="4K" badgeVariant="outline" />);
    expect(outline.root.findByType(Badge).props.variant).toBe('outline');
  });

  it('draws the focus border and springs to the focus scale', async () => {
    const onFocus = jest.fn();
    const renderer = await render(<PosterCard testID="card" title="长安" onFocus={onFocus} />);
    expect(focusBorder(renderer)).toHaveLength(0);

    await act(async () => host(renderer).props.onFocus({}));
    expect(focusBorder(renderer)).toHaveLength(1);
    expect(StyleSheet.flatten(focusBorder(renderer)[0]!.props.style).borderWidth).toBe(focus.borderWidth);
    expect(springSpy.mock.calls.at(-1)![1]).toMatchObject({ toValue: focus.scale });
    expect(StyleSheet.flatten(renderer.root.findAllByType(Text)[0]!.props.style).color).toBe(color.text);
    expect(onFocus).toHaveBeenCalledTimes(1);

    await act(async () => host(renderer).props.onBlur({}));
    expect(focusBorder(renderer)).toHaveLength(0);
    expect(springSpy.mock.calls.at(-1)![1]).toMatchObject({ toValue: 1 });
  });

  it('fires onPress and forwards the focus props', async () => {
    const onPress = jest.fn();
    const renderer = await render(
      <PosterCard testID="card" title="长安" onPress={onPress} hasTVPreferredFocus nextFocusUp={3} />,
    );
    await act(async () => host(renderer).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(host(renderer).props).toMatchObject({ hasTVPreferredFocus: true, nextFocusUp: 3 });
  });
});
