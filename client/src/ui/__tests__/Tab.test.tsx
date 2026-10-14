import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Tab } from '../Tab';
import { color, focus } from '../tokens';
import { fontFamily } from '../typography';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 }),
}));

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
const underline = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.type === View && n.props.testID === 'tab-underline');
const label = (renderer: ReactTestRenderer) => StyleSheet.flatten(renderer.root.findByType(Text).props.style);

describe('Tab', () => {
  it('underlines the active tab with the accent', async () => {
    const idle = await render(<Tab testID="tab" label="剧集" />);
    expect(idle.root.findByType(Text).props.children).toBe('剧集');
    expect(underline(idle)).toHaveLength(0);
    expect(label(idle).color).toBe(color.text2);

    const active = await render(<Tab testID="tab" label="首页" active />);
    expect(underline(active)).toHaveLength(1);
    expect(StyleSheet.flatten(underline(active)[0]!.props.style)).toMatchObject({
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 0,
      height: 4,
      backgroundColor: color.accent,
    });
    expect(label(active)).toMatchObject({ color: color.text, fontFamily: fontFamily.bold });
    expect(host(active).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('inverts while focused and keeps the active underline', async () => {
    const renderer = await render(<Tab testID="tab" label="首页" active />);
    await act(async () => host(renderer).props.onFocus({}));
    expect(style(renderer).backgroundColor).toBe(focus.borderColor);
    expect(underline(renderer)).toHaveLength(1);
    expect(label(renderer).color).toBe(color.inverseText);

    await act(async () => host(renderer).props.onBlur({}));
    expect(style(renderer).backgroundColor).toBeUndefined();
    expect(label(renderer).color).toBe(color.text);
  });

  it('pads the focus fill the same focused or not, offset so the layout keeps the 4 mockup padding', async () => {
    const renderer = await render(<Tab testID="tab" label="剧集" />);
    const box = { paddingHorizontal: 20, marginHorizontal: -16, paddingTop: 10, paddingBottom: 14, borderRadius: 14 };
    expect(style(renderer)).toMatchObject(box);
    await act(async () => host(renderer).props.onFocus({}));
    expect(style(renderer)).toMatchObject(box);
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
