import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { Clock, formatClock } from '../Clock';

void [Text];

const text = (renderer: ReactTestRenderer) => renderer.root.findByType(Text).props.children;

describe('Clock', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('formats HH:mm with zero padding', () => {
    expect(formatClock(new Date(2026, 9, 13, 7, 5, 59))).toBe('07:05');
    expect(formatClock(new Date(2026, 9, 13, 23, 41))).toBe('23:41');
  });

  it('renders tabular digits and ticks on the minute boundary', async () => {
    jest.setSystemTime(new Date(2026, 9, 13, 20, 41, 30));
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Clock testID="clock" />);
    });
    expect(text(renderer)).toBe('20:41');
    expect(renderer.root.findByType(Text).props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ fontVariant: ['tabular-nums'] })]),
    );

    await act(async () => jest.advanceTimersByTime(29_000));
    expect(text(renderer)).toBe('20:41');
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(text(renderer)).toBe('20:42');
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(text(renderer)).toBe('20:43');
  });

  it('clears its timer on unmount', async () => {
    jest.setSystemTime(new Date(2026, 9, 13, 20, 41, 30));
    const setSpy = jest.spyOn(global, 'setTimeout');
    const clearSpy = jest.spyOn(global, 'clearTimeout');
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Clock />);
    });
    const tick = setSpy.mock.calls.findIndex(([, delay]) => delay === 30_000);
    expect(tick).toBeGreaterThanOrEqual(0);
    await act(async () => renderer.unmount());
    expect(clearSpy).toHaveBeenCalledWith(setSpy.mock.results[tick]!.value);
    setSpy.mockRestore();
    clearSpy.mockRestore();
  });
});
