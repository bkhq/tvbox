import { AppState, type AppStateStatus } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { useBackgroundPause } from '../useBackgroundPause';
import { createTouchGestures, DOUBLE_TAP_DELAY, type TouchHandlers } from '../useTouchGestures';

describe('useBackgroundPause', () => {
  let listeners: ((status: AppStateStatus) => void)[];
  let removed: number;

  beforeEach(() => {
    listeners = [];
    removed = 0;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      listeners.push(listener as (status: AppStateStatus) => void);
      return { remove: () => (removed += 1) } as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  function Probe({ background, pause }: { background: boolean; pause: () => void }) {
    useBackgroundPause(background, pause);
    return null;
  }

  it('pauses on background and inactive when the setting is off, never resuming', async () => {
    const pause = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Probe background={false} pause={pause} />);
    });
    listeners.forEach((listener) => listener('inactive'));
    listeners.forEach((listener) => listener('background'));
    expect(pause).toHaveBeenCalledTimes(2);
    listeners.forEach((listener) => listener('active'));
    expect(pause).toHaveBeenCalledTimes(2);
    await act(async () => renderer.unmount());
    expect(removed).toBe(1);
  });

  it('leaves playback running when the setting is on', async () => {
    const pause = jest.fn();
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(<Probe background pause={pause} />);
    });
    expect(listeners).toHaveLength(0);

    await act(async () => renderer.update(<Probe background={false} pause={pause} />));
    listeners.forEach((listener) => listener('background'));
    expect(pause).toHaveBeenCalledTimes(1);
    await act(async () => renderer.unmount());
  });
});

describe('touch gestures', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function setup() {
    const handlers: TouchHandlers = {
      width: 1000,
      onSingleTap: jest.fn(),
      onDoubleTap: jest.fn(),
      onSeeking: jest.fn(),
      onSeekEnd: jest.fn(),
    };
    const gestures = createTouchGestures();
    gestures.setHandlers(handlers);
    return { handlers, gestures };
  }

  it('tells a single tap from a double tap', () => {
    const { handlers, gestures } = setup();
    gestures.release({ dx: 0, dy: 0 });
    jest.advanceTimersByTime(DOUBLE_TAP_DELAY);
    expect(handlers.onSingleTap).toHaveBeenCalledTimes(1);

    gestures.release({ dx: 0, dy: 0 });
    gestures.release({ dx: 2, dy: 0 });
    jest.advanceTimersByTime(DOUBLE_TAP_DELAY);
    expect(handlers.onDoubleTap).toHaveBeenCalledTimes(1);
    expect(handlers.onSingleTap).toHaveBeenCalledTimes(1);
  });

  it('seeks with a horizontal drag', () => {
    const { handlers, gestures } = setup();
    gestures.move({ dx: 5, dy: 0 });
    expect(handlers.onSeeking).not.toHaveBeenCalled();
    gestures.move({ dx: 500, dy: 10 });
    expect(handlers.onSeeking).toHaveBeenLastCalledWith(90_000);
    gestures.release({ dx: -250, dy: 0 });
    expect(handlers.onSeekEnd).toHaveBeenCalledWith(-45_000);
    jest.advanceTimersByTime(DOUBLE_TAP_DELAY);
    expect(handlers.onSingleTap).not.toHaveBeenCalled();
  });
});
