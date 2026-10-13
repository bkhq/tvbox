import { Animated } from 'react-native';
import { act, create } from 'react-test-renderer';

import {
  focusSpring,
  useFocusAnimation,
  type FocusAnimation,
  type FocusAnimationCallbacks,
} from '../useFocusAnimation';

const springSpy = jest.spyOn(Animated, 'spring');

function lastSpring() {
  const [value, config] = springSpy.mock.calls.at(-1)!;
  return { value, config };
}

async function renderHook(callbacks?: FocusAnimationCallbacks) {
  const ref: { current?: FocusAnimation } = {};
  function Probe() {
    ref.current = useFocusAnimation(callbacks);
    return null;
  }
  await act(async () => {
    create(<Probe />);
  });
  return ref as { current: FocusAnimation };
}

const event = {} as never;

describe('useFocusAnimation', () => {
  beforeEach(() => springSpy.mockClear());

  it('springs to 1.08 on focus, 1.02 while pressed and back to 1', async () => {
    const hook = await renderHook();
    expect(hook.current).toMatchObject({ focused: false, pressed: false });
    expect(lastSpring().config).toMatchObject({ toValue: 1, useNativeDriver: true, ...focusSpring });
    expect(hook.current.animatedStyle.transform[0]!.scale).toBe(lastSpring().value);

    await act(async () => hook.current.handlers.onFocus(event));
    expect(hook.current.focused).toBe(true);
    expect(lastSpring().config.toValue).toBe(1.08);

    await act(async () => hook.current.handlers.onPressIn(event));
    expect(hook.current.pressed).toBe(true);
    expect(lastSpring().config.toValue).toBe(1.02);

    await act(async () => hook.current.handlers.onPressOut(event));
    expect(hook.current.pressed).toBe(false);
    expect(lastSpring().config.toValue).toBe(1.08);

    await act(async () => hook.current.handlers.onBlur(event));
    expect(hook.current.focused).toBe(false);
    expect(lastSpring().config.toValue).toBe(1);
  });

  it('chains the caller callbacks', async () => {
    const callbacks = { onFocus: jest.fn(), onBlur: jest.fn(), onPressIn: jest.fn(), onPressOut: jest.fn() };
    const hook = await renderHook(callbacks);
    await act(async () => {
      hook.current.handlers.onFocus(event);
      hook.current.handlers.onPressIn(event);
      hook.current.handlers.onPressOut(event);
      hook.current.handlers.onBlur(event);
    });
    for (const callback of Object.values(callbacks)) expect(callback).toHaveBeenCalledWith(event);
  });
});
