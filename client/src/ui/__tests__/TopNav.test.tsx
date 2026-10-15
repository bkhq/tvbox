import type { ReactElement } from 'react';
import { StyleSheet, Text, TVFocusGuideView } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

import type { MainNavItem } from '../../navigation/mainNav';
import { Clock } from '../Clock';
import { Logo } from '../Logo';
import { Tab } from '../Tab';
import { TopNav } from '../TopNav';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  __esModule: true,
  default: () => ({ width: 1920, height: 1080, scale: 1, fontScale: 1 }),
}));

void [Text];

const items: MainNavItem[] = [
  { key: 'home', label: '首页', active: true },
  { key: 'movie', label: '电影', active: false },
  { key: 'live', label: '直播', active: false },
];

async function render(element: React.ReactElement) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(element);
  });
  return renderer;
}

function host(renderer: ReactTestRenderer, testID: string): ReactTestInstance {
  return renderer.root.findAll((n) => typeof n.type === 'string' && n.props.testID === testID)[0]!;
}

describe('TopNav', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('renders the logo, the tabs, the clock and the right slot', async () => {
    const renderer = await render(
      <TopNav items={items} onSelect={() => {}} right={<Text testID="slot">手机控制</Text>} />,
    );
    expect(renderer.root.findAllByType(Logo)).toHaveLength(1);
    expect(renderer.root.findAllByType(Clock)).toHaveLength(1);
    expect(renderer.root.findAllByType(Tab).map((tab) => [tab.props.label, !!tab.props.active])).toEqual([
      ['首页', true],
      ['电影', false],
      ['直播', false],
    ]);
    expect(renderer.root.findAll((n) => n.props.testID === 'slot').length).toBeGreaterThan(0);
    // The clock keeps the right edge whatever the slot holds.
    const [right] = renderer.root.findAll(
      (n) => Array.isArray(n.props.children) && n.props.children.some((child: ReactElement) => child?.type === Clock),
    );
    expect(right?.props.children.at(-1).type).toBe(Clock);
  });

  it('is a focus guide that traps left/right inside the bar', async () => {
    const renderer = await render(<TopNav testID="bar" items={items} onSelect={() => {}} />);
    const guide = renderer.root.findByType(TVFocusGuideView);
    expect(guide.props).toMatchObject({ autoFocus: true, trapFocusLeft: true, trapFocusRight: true });
    expect(StyleSheet.flatten(guide.props.style)).toMatchObject({
      height: 150,
      paddingTop: 44,
      paddingHorizontal: 96,
      justifyContent: 'space-between',
    });
  });

  it('calls onSelect with the tab key and onSearch from the search button', async () => {
    const onSelect = jest.fn();
    const onSearch = jest.fn();
    const renderer = await render(<TopNav items={items} onSelect={onSelect} onSearch={onSearch} />);
    await act(async () => host(renderer, 'top-nav-movie').props.onClick({ nativeEvent: {} }));
    expect(onSelect).toHaveBeenCalledWith('movie');
    await act(async () => host(renderer, 'top-nav-search').props.onClick({ nativeEvent: {} }));
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it('inverts the search button while focused', async () => {
    const renderer = await render(<TopNav items={items} onSelect={() => {}} />);
    const search = () => host(renderer, 'top-nav-search');
    expect(StyleSheet.flatten(search().props.style).backgroundColor).toBeUndefined();
    await act(async () => search().props.onFocus({}));
    expect(StyleSheet.flatten(search().props.style).backgroundColor).toBe('#FFFFFF');
  });
});
