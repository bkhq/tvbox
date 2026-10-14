import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { FocusRing } from '../Button';
import { Icon } from '../Icon';
import { OptionRow } from '../OptionRow';
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
  return renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'row')[0]!;
}

const style = (renderer: ReactTestRenderer) => StyleSheet.flatten(host(renderer).props.style);
const texts = (renderer: ReactTestRenderer) => renderer.root.findAllByType(Text);
const textStyle = (node: ReactTestInstance) => StyleSheet.flatten(node.props.style);

describe('OptionRow', () => {
  it('renders the label alone on the surface fill', async () => {
    const renderer = await render(<OptionRow testID="row" label="自动" />);
    expect(texts(renderer).map((t) => t.props.children)).toEqual(['自动']);
    expect(style(renderer).backgroundColor).toBe(color.surface);
    expect(textStyle(texts(renderer)[0]!)).toMatchObject({ color: color.text, fontFamily: fontFamily.semiBold });
    expect(renderer.root.findAllByType(Icon)).toHaveLength(0);
    expect(host(renderer).props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: '自动',
      accessibilityState: { selected: false, disabled: false },
    });
  });

  it('shows the value on the right and the hint under the label', async () => {
    const renderer = await render(<OptionRow testID="row" label="解码方式" hint="硬解更省电" value="硬解" raised />);
    const [label, hint, value] = texts(renderer);
    expect([label, hint, value].map((t) => t!.props.children)).toEqual(['解码方式', '硬解更省电', '硬解']);
    expect(textStyle(hint!).color).toBe(color.text3);
    expect(textStyle(value!).color).toBe(color.text2);
    expect(style(renderer).backgroundColor).toBe(color.surface2);
  });

  it('marks the selected row with an accent label and check', async () => {
    const renderer = await render(<OptionRow testID="row" label="1.5x" selected />);
    expect(textStyle(texts(renderer)[0]!)).toMatchObject({ color: color.accent, fontFamily: fontFamily.bold });
    expect(renderer.root.findByType(Icon).props).toMatchObject({ name: 'check', color: color.accent });
    expect(host(renderer).props.accessibilityState).toEqual({ selected: true, disabled: false });
  });

  it('inverts with an outer ring while focused', async () => {
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const renderer = await render(
      <OptionRow testID="row" label="线路一" value="1080P" selected onFocus={onFocus} onBlur={onBlur} />,
    );
    await act(async () => host(renderer).props.onFocus({}));
    expect(style(renderer).backgroundColor).toBe(focus.borderColor);
    for (const node of texts(renderer)) expect(textStyle(node).color).toBe(color.inverseText);
    expect(renderer.root.findByType(Icon).props.color).toBe(color.inverseText);
    expect(renderer.root.findAllByType(FocusRing)).toHaveLength(1);
    expect(onFocus).toHaveBeenCalledTimes(1);

    await act(async () => host(renderer).props.onBlur({}));
    expect(style(renderer).backgroundColor).toBe(color.surface);
    expect(renderer.root.findAllByType(FocusRing)).toHaveLength(0);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('fires onPress, forwards the focus props and blocks presses while disabled', async () => {
    const onPress = jest.fn();
    const enabled = await render(
      <OptionRow testID="row" label="线路二" onPress={onPress} hasTVPreferredFocus nextFocusUp={3} />,
    );
    await act(async () => host(enabled).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(host(enabled).props).toMatchObject({ hasTVPreferredFocus: true, nextFocusUp: 3 });

    const disabled = await render(<OptionRow testID="row" label="线路三" onPress={onPress} disabled />);
    await act(async () => host(disabled).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(style(disabled).opacity).toBe(0.4);
    expect(host(disabled).props.accessibilityState).toEqual({ selected: false, disabled: true });
  });
});
