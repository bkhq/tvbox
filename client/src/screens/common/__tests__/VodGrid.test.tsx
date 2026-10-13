import { FlatList, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { normalizeVod, type Vod } from '../../../core/types';

const renders: string[] = [];

jest.mock('../../../ui', () => {
  const actual = jest.requireActual('../../../ui');
  const { createElement } = jest.requireActual('react');
  return {
    ...actual,
    PosterCard: (props: { title: string }) => {
      renders.push(props.title);
      return createElement(actual.PosterCard, props);
    },
  };
});

// eslint-disable-next-line import/first
import { posterWidth, VodGrid } from '../VodGrid';

function vods(prefix: string, count: number, extra: Partial<Vod> = {}): Vod[] {
  return Array.from({ length: count }, (_, i) =>
    normalizeVod({ vod_id: `${prefix}${i}`, vod_name: `${prefix}${i}`, ...extra }),
  );
}

// The outermost match carries the props given by VodGrid.
const card = (renderer: ReactTestRenderer, id: string) =>
  renderer.root.findAll((node) => node.props.testID === `vod-card-${id}`)[0]!;

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));

describe('posterWidth', () => {
  it('uses the poster token at 7 columns and fills the safe area otherwise', () => {
    expect(posterWidth(7)).toBe(224);
    // (1920 - 2 * 96 - 4 * 24) / 5
    expect(posterWidth(5)).toBe(326);
    // (1200 - 2 * 96 - 3 * 24) / 4
    expect(posterWidth(4, 1200)).toBe(234);
  });
});

describe('VodGrid', () => {
  // VirtualizedList batches cell updates on a 50 ms timer; fake timers keep it from firing after a test.
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  beforeEach(() => {
    renders.length = 0;
  });

  it('renders poster cards in a 7-column grid with the remarks as meta', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <VodGrid items={vods('a', 2, { vod_remarks: 'HD' })} onPressVod={jest.fn()} preferFirstFocus />,
      );
    });
    expect(renderer.root.findByType(FlatList).props.numColumns).toBe(7);
    expect(renderer.root.findAll((node) => node.props.testID === 'vod-grid')).not.toHaveLength(0);
    expect(card(renderer, 'a0').props).toMatchObject({
      width: 224,
      meta: 'HD',
      badge: undefined,
      hasTVPreferredFocus: true,
    });
    expect(card(renderer, 'a1').props.hasTVPreferredFocus).toBe(false);
    act(() => renderer.unmount());
  });

  it('supports columns, width, metaOf, badgeOf and testID', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(
        <VodGrid
          testID="result-grid"
          items={vods('a', 1, { vod_year: '2024' })}
          columns={4}
          width={1200}
          metaOf={(vod) => `站 · ${vod.vod_year}`}
          badgeOf={() => '8.6'}
          onPressVod={jest.fn()}
        />,
      );
    });
    expect(renderer.root.findByType(FlatList).props).toMatchObject({ numColumns: 4, testID: 'result-grid' });
    expect(card(renderer, 'a0').props).toMatchObject({ width: 234, meta: '站 · 2024', badge: '8.6' });
    expect(card(renderer, 'a0').props.hasTVPreferredFocus).toBe(false);
    act(() => renderer.unmount());
  });

  it('omits the meta line when the source has no remarks', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<VodGrid items={vods('a', 1)} onPressVod={jest.fn()} />);
    });
    expect(card(renderer, 'a0').props.meta).toBeUndefined();
    act(() => renderer.unmount());
  });

  it('shows the empty state only when not loading', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<VodGrid items={[]} onPressVod={jest.fn()} />);
    });
    expect(texts(renderer)).toContain('暂无内容');

    act(() => {
      renderer.update(<VodGrid items={[]} onPressVod={jest.fn()} ListEmptyComponent={<Text>没有结果</Text>} />);
    });
    expect(texts(renderer)).toEqual(['没有结果']);

    act(() => {
      renderer.update(<VodGrid items={[]} loading onPressVod={jest.fn()} ListEmptyComponent={<Text>没有结果</Text>} />);
    });
    expect(texts(renderer)).toEqual([]);
    expect(renderer.root.findByType(FlatList).props.ListFooterComponent).not.toBeNull();
    act(() => renderer.unmount());
  });

  it('does not re-render existing cards when the handler changes or full rows get more results', () => {
    const first = vods('a', 7);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<VodGrid items={first} onPressVod={jest.fn()} metaOf={(vod) => vod.vod_name} />);
    });
    expect(renders).toHaveLength(7);

    renders.length = 0;
    act(() => {
      renderer.update(<VodGrid items={first} onPressVod={jest.fn()} metaOf={(vod) => vod.vod_name} />);
    });
    expect(renders).toEqual([]);

    act(() => {
      renderer.update(
        <VodGrid items={[...first, ...vods('b', 1)]} onPressVod={jest.fn()} metaOf={(vod) => vod.vod_name} />,
      );
    });
    expect(renders).toEqual(['b0']);
    act(() => renderer.unmount());
  });

  it('calls the latest press handler', () => {
    const items = vods('a', 1);
    const stale = jest.fn();
    const latest = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<VodGrid items={items} onPressVod={stale} />);
    });
    act(() => {
      renderer.update(<VodGrid items={items} onPressVod={latest} />);
    });
    act(() => {
      renderer.root.findByProps({ testID: 'vod-card-a0', accessibilityRole: 'button' }).props.onPress();
    });
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(items[0]);
    act(() => renderer.unmount());
  });
});
