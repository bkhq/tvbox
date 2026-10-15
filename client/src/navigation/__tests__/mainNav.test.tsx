import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import {
  getMainNavAvailability,
  mainNavTabs,
  setMainNavAvailability,
  subscribeMainNavAvailability,
  useMainNav,
  type MainNavKey,
} from '../mainNav';

const mockNavigate = jest.fn();
jest.mock('../useAppNavigation', () => ({ useAppNavigation: () => ({ navigate: mockNavigate }) }));

type MainNav = ReturnType<typeof useMainNav>;

const onRender = jest.fn<void, [MainNav]>();
const latest = (): MainNav => onRender.mock.calls[onRender.mock.calls.length - 1]![0];

function Probe({ active, report }: { active: MainNavKey; report: (nav: MainNav) => void }) {
  report(useMainNav(active));
  return null;
}

async function render(active: MainNavKey) {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(<Probe active={active} report={onRender} />);
  });
  return renderer;
}

describe('mainNav', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
    onRender.mockClear();
    setMainNavAvailability({ series: true, movie: true });
  });

  it('lists the five tabs with the active one marked', async () => {
    await render('home');
    expect(latest().items).toEqual([
      { key: 'home', label: '首页', active: true },
      { key: 'series', label: '剧集', active: false },
      { key: 'movie', label: '电影', active: false },
      { key: 'live', label: '直播', active: false },
      { key: 'profile', label: '设置', active: false },
    ]);
    expect(mainNavTabs.map((tab) => tab.key)).toEqual(['home', 'series', 'movie', 'live', 'profile']);
  });

  it('hides series and movie through the store and re-renders subscribers', async () => {
    await render('live');
    const before = onRender.mock.calls.length;
    await act(async () => setMainNavAvailability({ series: false }));
    expect(onRender.mock.calls.length).toBeGreaterThan(before);
    expect(latest().items.map((item) => item.key)).toEqual(['home', 'movie', 'live', 'profile']);
    expect(getMainNavAvailability()).toEqual({ series: false, movie: true });

    await act(async () => setMainNavAvailability({ movie: false }));
    expect(latest().items.map((item) => item.key)).toEqual(['home', 'live', 'profile']);

    await act(async () => setMainNavAvailability({ series: true, movie: true }));
    expect(latest().items).toHaveLength(5);
  });

  it('notifies listeners only on a change and stops after unsubscribe', () => {
    const listener = jest.fn();
    const unsubscribe = subscribeMainNavAvailability(listener);
    setMainNavAvailability({ series: true });
    expect(listener).not.toHaveBeenCalled();
    setMainNavAvailability({ movie: false });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    setMainNavAvailability({ movie: true });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('navigates to the tab route with its params', async () => {
    await render('profile');
    latest().select('home');
    latest().select('series');
    latest().select('movie');
    latest().select('live');
    expect(mockNavigate.mock.calls).toEqual([
      ['Home', {}],
      ['Home', { section: 'series' }],
      ['Home', { section: 'movie' }],
      ['Live'],
    ]);

    mockNavigate.mockClear();
    await render('home');
    latest().select('profile');
    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });

  it('ignores the active tab', async () => {
    await render('series');
    latest().select('series');
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
