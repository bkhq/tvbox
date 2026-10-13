import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Button } from '../Button';
import { color, focus } from '../tokens';

// Resolve the lazily loaded components up front so no test pays for it inside its timeout.
void [Animated, Pressable, Text, View];

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

function host(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'btn')[0]!;
}

const style = (renderer: ReactTestRenderer) => StyleSheet.flatten(host(renderer).props.style);
const label = (renderer: ReactTestRenderer) => StyleSheet.flatten(renderer.root.findByType(Text).props.style);
const ring = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (n) => n.type === View && StyleSheet.flatten(n.props.style)?.borderColor === focus.borderColor,
  );

describe('Button', () => {
  it('renders the variants with their unfocused fills', async () => {
    const primary = await render(<Button testID="btn" title="立即播放" icon="play" variant="primary" />);
    expect(style(primary).backgroundColor).toBe(color.accent);
    expect(label(primary).color).toBe(color.inverseText);
    expect(primary.root.findByType(Text).props.children).toBe('立即播放');

    const secondary = await render(<Button testID="btn" title="加入片单" icon="plus" />);
    expect(style(secondary).backgroundColor).toBe(color.buttonFill);
    expect(label(secondary).color).toBe(color.text);

    const icon = await render(<Button testID="btn" icon="like" variant="icon" accessibilityLabel="点赞" />);
    const round = style(icon);
    expect(round.width).toBe(round.height);
    expect(round.borderRadius).toBe((round.height as number) / 2);
    expect(round.backgroundColor).toBe(color.buttonFill);
    expect(host(icon).props.accessibilityLabel).toBe('点赞');
    expect(icon.root.findAllByType(Text)).toHaveLength(0);
  });

  it('inverts with an outer ring while focused', async () => {
    const onFocus = jest.fn();
    const renderer = await render(<Button testID="btn" title="加入片单" onFocus={onFocus} />);
    expect(ring(renderer)).toHaveLength(0);

    await act(async () => host(renderer).props.onFocus({}));
    expect(style(renderer).backgroundColor).toBe(focus.borderColor);
    expect(label(renderer).color).toBe(color.inverseText);
    expect(ring(renderer)).toHaveLength(1);
    expect(onFocus).toHaveBeenCalledTimes(1);

    await act(async () => host(renderer).props.onBlur({}));
    expect(style(renderer).backgroundColor).toBe(color.buttonFill);
    expect(ring(renderer)).toHaveLength(0);
  });

  it('fires onPress and forwards the focus props', async () => {
    const onPress = jest.fn();
    const renderer = await render(
      <Button testID="btn" title="播放" onPress={onPress} hasTVPreferredFocus nextFocusDown={7} />,
    );
    await act(async () => host(renderer).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(host(renderer).props).toMatchObject({ hasTVPreferredFocus: true, nextFocusDown: 7 });
  });

  it('blocks presses while disabled', async () => {
    const onPress = jest.fn();
    const renderer = await render(<Button testID="btn" title="播放" onPress={onPress} disabled />);
    await act(async () => host(renderer).props.onClick({ nativeEvent: {} }));
    expect(onPress).not.toHaveBeenCalled();
    expect(style(renderer).opacity).toBe(0.4);
  });
});
