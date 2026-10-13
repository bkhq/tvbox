import { ActivityIndicator, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { color } from '../../../ui';
import { ErrorView, LoadingView } from '../StatusViews';

const texts = (renderer: ReactTestRenderer) =>
  renderer.root.findAllByType(Text).map((node) => [node.props.children].flat().join(''));

describe('ErrorView', () => {
  it('shows the message and a focusable retry button', () => {
    const onRetry = jest.fn();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ErrorView testID="x-error" message="加载失败" onRetry={onRetry} hasTVPreferredFocus />);
    });
    expect(texts(renderer)).toEqual(['加载失败', '重试']);
    const retry = renderer.root.findAll((node) => node.props.testID === 'x-error-retry')[0]!;
    expect(retry.props.hasTVPreferredFocus).toBe(true);
    act(() => retry.props.onPress());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('has no retry button without onRetry', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<ErrorView testID="x-error" message="站点不可用" />);
    });
    expect(texts(renderer)).toEqual(['站点不可用']);
    expect(renderer.root.findAll((node) => node.props.testID === 'x-error-retry')).toHaveLength(0);
  });
});

describe('LoadingView', () => {
  it('shows an accent spinner with the default or given text', () => {
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(<LoadingView />);
    });
    expect(renderer.root.findByType(ActivityIndicator).props.color).toBe(color.accent);
    expect(texts(renderer)).toEqual(['正在加载…']);
    act(() => renderer.update(<LoadingView text="正在搜索…" />));
    expect(texts(renderer)).toEqual(['正在搜索…']);
  });
});
