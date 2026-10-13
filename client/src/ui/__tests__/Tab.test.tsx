import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Tab } from '../Tab';
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
  return renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === 'tab')[0]!;
}

const style = (renderer: ReactTestRenderer) => StyleSheet.flatten(host(renderer).props.style);
const label = (renderer: ReactTestRenderer) => StyleSheet.flatten(renderer.root.findByType(Text).props.style);

describe('Tab', () => {
  it('underlines the active tab with the accent', async () => {
    const idle = await render(<Tab testID="tab" label="剧集" />);
    expect(idle.root.findByType(Text).props.children).toBe('剧集');
    expect(style(idle).borderBottomColor).toBe('transparent');
    expect(label(idle).color).toBe(color.text2);

    const active = await render(<Tab testID="tab" label="首页" active />);
    expect(style(active).borderBottomColor).toBe(color.accent);
    expect(label(active)).toMatchObject({ color: color.text, fontFamily: fontFamily.bold });
    expect(host(active).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('inverts while focused and keeps the active underline', async () => {
    const renderer = await render(<Tab testID="tab" label="首页" active />);
    await act(async () => host(renderer).props.onFocus({}));
    expect(style(renderer)).toMatchObject({ backgroundColor: focus.borderColor, borderBottomColor: color.accent });
    expect(label(renderer).color).toBe(color.inverseText);

    await act(async () => host(renderer).props.onBlur({}));
    expect(style(renderer).backgroundColor).toBeUndefined();
    expect(label(renderer).color).toBe(color.text);
  });

  it('fires onPress unless disabled', async () => {
    const onPress = jest.fn();
    const enabled = await render(<Tab testID="tab" label="电影" onPress={onPress} />);
    await act(async () => host(enabled).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);

    const disabled = await render(<Tab testID="tab" label="电影" onPress={onPress} disabled />);
    await act(async () => host(disabled).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
