import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import { Badge } from '../Badge';
import { ChannelCard } from '../ChannelCard';
import { Icon } from '../Icon';
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

const style = (renderer: ReactTestRenderer) => StyleSheet.flatten(host(renderer).props.style);
const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.type === Text && typeof n.props.children === 'string').map((n) => n.props.children);
const focusBorder = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((n) => n.type === View && StyleSheet.flatten(n.props.style)?.borderColor === focus.borderColor);

describe('ChannelCard', () => {
  it('renders the live tile with number, name and programme', async () => {
    const renderer = await render(
      <ChannelCard testID="card" number="03" name="体育频道" program="联赛直播 · 下半场" />,
    );
    expect(style(renderer)).toMatchObject({ width: 260, height: 146, backgroundColor: 'rgba(255,255,255,0.08)' });
    expect(texts(renderer)).toEqual(['03', '体育频道', '联赛直播 · 下半场']);
    expect(renderer.root.findAllByType(Badge)).toHaveLength(0);
    expect(renderer.root.findAllByType(Icon)).toHaveLength(0);
  });

  it('shows 正在看 only while playing', async () => {
    const renderer = await render(<ChannelCard testID="card" number="02" name="影视频道" playing />);
    expect(renderer.root.findByType(Badge).props).toMatchObject({ label: '正在看', variant: 'live' });
    expect(style(renderer).backgroundColor).toBe(color.buttonFill);
    expect(host(renderer).props.accessibilityState).toMatchObject({ selected: true });
  });

  it('marks favourites with a filled accent heart', async () => {
    const renderer = await render(<ChannelCard number="04" name="纪实频道" favourite />);
    expect(renderer.root.findByType(Icon).props).toMatchObject({ name: 'heartFilled', color: color.accent });
  });

  it('shows the logo in place of the number', async () => {
    const renderer = await render(<ChannelCard number="04" name="纪实频道" logo="http://a/logo.png" />);
    expect(renderer.root.findByType(Image).props.source).toEqual({ uri: 'http://a/logo.png' });
    expect(texts(renderer)).toEqual(['纪实频道']);
  });

  it('draws the focus border and springs to the focus scale', async () => {
    const renderer = await render(<ChannelCard testID="card" number="01" name="综合频道" />);
    expect(focusBorder(renderer)).toHaveLength(0);

    await act(async () => host(renderer).props.onFocus({}));
    expect(focusBorder(renderer)).toHaveLength(1);
    expect(style(renderer).backgroundColor).toBe(color.surface2);
    expect(springSpy.mock.calls.at(-1)![1]).toMatchObject({ toValue: focus.scale });

    await act(async () => host(renderer).props.onBlur({}));
    expect(focusBorder(renderer)).toHaveLength(0);
  });

  it('fires onPress and forwards the focus props', async () => {
    const onPress = jest.fn();
    const renderer = await render(
      <ChannelCard testID="card" number="01" name="综合频道" onPress={onPress} hasTVPreferredFocus nextFocusDown={5} />,
    );
    await act(async () => host(renderer).props.onClick({ nativeEvent: {} }));
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(host(renderer).props).toMatchObject({ hasTVPreferredFocus: true, nextFocusDown: 5 });
  });
});
