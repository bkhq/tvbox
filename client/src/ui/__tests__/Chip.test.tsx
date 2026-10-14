import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Chip } from '../Chip';
import { color, focus } from '../tokens';
import { fontFamily } from '../typography';

void [Animated, Pressable, Text, View];

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

function host(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'chip')[0]!;
}

const style = (renderer: ReactTestRenderer) => StyleSheet.flatten(host(renderer).props.style);
const label = (renderer: ReactTestRenderer) => StyleSheet.flatten(renderer.root.findByType(Text).props.style);
const ring = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (n) => n.type === View && StyleSheet.flatten(n.props.style)?.borderColor === focus.borderColor,
  );

describe('Chip', () => {
  it('renders a pill with the selected fill', async () => {
    const plain = await render(<Chip testID="chip" label="电影" />);
    expect(plain.root.findByType(Text).props.children).toBe('电影');
    expect(style(plain).backgroundColor).toBe(color.surface2);
    expect(style(plain).borderRadius).toBe((style(plain).height as number) / 2);
    expect(label(plain)).toMatchObject({ color: color.text, fontFamily: fontFamily.semiBold });

    const selected = await render(<Chip testID="chip" label="电影" selected />);
    expect(style(selected).backgroundColor).toBe(color.text);
    expect(label(selected)).toMatchObject({ color: color.inverseText, fontFamily: fontFamily.bold });
    expect(host(selected).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('fills a selected accent chip with the accent colour', async () => {
    const renderer = await render(<Chip testID="chip" label="线路一" variant="accent" selected />);
    expect(style(renderer).backgroundColor).toBe(color.accent);
    expect(label(renderer)).toMatchObject({ color: color.inverseText, fontFamily: fontFamily.bold });

    await act(async () => host(renderer).props.onFocus({}));
    expect(style(renderer).backgroundColor).toBe(focus.borderColor);
    expect(ring(renderer)).toHaveLength(1);

    const plain = await render(<Chip testID="chip" label="线路二" variant="accent" />);
    expect(style(plain).backgroundColor).toBe(color.surface2);
  });

  it('inverts with an outer ring while focused', async () => {
    const renderer = await render(<Chip testID="chip" label="剧集" />);
    await act(async () => host(renderer).props.onFocus({}));
    expect(style(renderer).backgroundColor).toBe(focus.borderColor);
    expect(label(renderer).color).toBe(color.inverseText);
    expect(ring(renderer)).toHaveLength(1);

    await act(async () => host(renderer).props.onBlur({}));
    expect(style(renderer).backgroundColor).toBe(color.surface2);
    expect(ring(renderer)).toHaveLength(0);
  });

  it('fires onPress unless disabled', async () => {
    const onPress = jest.fn();
    const enabled = await render(<Chip testID="chip" label="综艺" onPress={onPress} />);
    await act(async () => host(enabled).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);

    const disabled = await render(<Chip testID="chip" label="综艺" onPress={onPress} disabled />);
    await act(async () => host(disabled).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
