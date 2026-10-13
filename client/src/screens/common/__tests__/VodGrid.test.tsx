import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Dimensions, Platform } from 'react-native';

import { normalizeVod, type Vod } from '../../../core/types';
import { computeLayout } from '../../../ui';

const renders: string[] = [];

jest.mock('../../../ui', () => {
  const actual = jest.requireActual('../../../ui');
  return {
    ...actual,
    FocusableCard: (props: { title: string }) => {
      renders.push(props.title);
      return actual.FocusableCard(props);
    },
  };
});

// eslint-disable-next-line import/first
import { VodGrid } from '../VodGrid';

function vods(prefix: string, count: number): Vod[] {
  return Array.from({ length: count }, (_, i) => normalizeVod({ vod_id: `${prefix}${i}`, vod_name: `${prefix}${i}` }));
}

const { width, height } = Dimensions.get('window');
const columns = computeLayout(width, height, Platform.isTV).columns;

describe('VodGrid', () => {
  beforeEach(() => {
    renders.length = 0;
  });

  it('does not re-render existing cards when the handler changes or full rows get more results', () => {
    const first = vods('a', columns);
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<VodGrid items={first} onPressVod={jest.fn()} />);
    });
    expect(renders).toHaveLength(columns);

    renders.length = 0;
    act(() => {
      renderer.update(<VodGrid items={first} onPressVod={jest.fn()} />);
    });
    expect(renders).toEqual([]);

    act(() => {
      renderer.update(<VodGrid items={[...first, ...vods('b', 1)]} onPressVod={jest.fn()} />);
    });
    expect(renders).toEqual(['b0']);
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
  });
});
