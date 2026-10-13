import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { BackButton } from '../BackButton';
import { Icon } from '../Icon';
import { color, focus } from '../tokens';

void [Animated, Pressable, Text, View];

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

function host(renderer: ReactTestRenderer): ReactTestInstance {
  return renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'back')[0]!;
}

const style = (renderer: ReactTestRenderer) => StyleSheet.flatten(host(renderer).props.style);
const label = (renderer: ReactTestRenderer) => StyleSheet.flatten(renderer.root.findByType(Text).props.style);
const ring = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (n) => n.type === View && StyleSheet.flatten(n.props.style)?.borderColor === focus.borderColor,
  );

describe('BackButton', () => {
  it('renders the 返回 pill with the back icon', async () => {
    const renderer = await render(<BackButton testID="back" onPress={() => {}} />);
    expect(renderer.root.findByType(Text).props.children).toBe('返回');
    expect(renderer.root.findByType(Icon).props).toMatchObject({ name: 'back', color: color.text });
    expect(style(renderer).backgroundColor).toBe(color.buttonFill);
    expect(style(renderer).borderRadius).toBeCloseTo((style(renderer).height as number) / 2, 0);
  });

  it('inverts with an outer ring while focused', async () => {
    const renderer = await render(<BackButton testID="back" onPress={() => {}} />);
    await act(async () => host(renderer).props.onFocus({}));
    expect(style(renderer).backgroundColor).toBe(focus.borderColor);
    expect(label(renderer).color).toBe(color.inverseText);
    expect(renderer.root.findByType(Icon).props.color).toBe(color.inverseText);
    expect(ring(renderer)).toHaveLength(1);

    await act(async () => host(renderer).props.onBlur({}));
    expect(ring(renderer)).toHaveLength(0);
  });

  it('fires onPress unless disabled', async () => {
    const onPress = jest.fn();
    const enabled = await render(<BackButton testID="back" onPress={onPress} />);
    await act(async () => host(enabled).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);

    const disabled = await render(<BackButton testID="back" onPress={onPress} disabled />);
    await act(async () => host(disabled).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
