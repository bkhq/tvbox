import { useEffect, useState } from 'react';
import { type GestureResponderHandlers, PanResponder, type PanResponderGestureState } from 'react-native';

/** Taps closer together than this are a double tap. */
export const DOUBLE_TAP_DELAY = 300;
/** Horizontal movement before a touch becomes a seek drag. */
const DRAG_SLOP = 12;
/** A drag across the full width seeks this far. */
const DRAG_RANGE = 180_000;

export interface TouchHandlers {
  /** Width of the touch surface, px. */
  width: number;
  onSingleTap(): void;
  onDoubleTap(): void;
  onSeeking(offset: number): void;
  onSeekEnd(offset: number): void;
}

type Gesture = Pick<PanResponderGestureState, 'dx' | 'dy'>;

export interface TouchGestures {
  setHandlers(handlers: TouchHandlers): void;
  /** Gesture steps, exposed for tests. */
  move(gesture: Gesture): void;
  release(gesture: Gesture): void;
  terminate(gesture: Gesture): void;
  panHandlers: GestureResponderHandlers;
  dispose(): void;
}

/** Phone gestures over the video (CustomKeyDownVod): tap, double tap and horizontal drag seek. */
export function createTouchGestures(): TouchGestures {
  let handlers: TouchHandlers | undefined;
  let dragging = false;
  let tapTimer: ReturnType<typeof setTimeout> | undefined;
  const offset = (dx: number) => Math.round((dx / Math.max(1, handlers?.width ?? 1)) * DRAG_RANGE);
  const tap = () => {
    if (tapTimer) {
      clearTimeout(tapTimer);
      tapTimer = undefined;
      handlers?.onDoubleTap();
      return;
    }
    tapTimer = setTimeout(() => {
      tapTimer = undefined;
      handlers?.onSingleTap();
    }, DOUBLE_TAP_DELAY);
  };
  const gestures: TouchGestures = {
    setHandlers(next) {
      handlers = next;
    },
    move(gesture) {
      if (!dragging && Math.abs(gesture.dx) > DRAG_SLOP && Math.abs(gesture.dx) > Math.abs(gesture.dy)) dragging = true;
      if (dragging) handlers?.onSeeking(offset(gesture.dx));
    },
    release(gesture) {
      if (dragging) handlers?.onSeekEnd(offset(gesture.dx));
      else if (Math.abs(gesture.dx) <= DRAG_SLOP && Math.abs(gesture.dy) <= DRAG_SLOP) tap();
      dragging = false;
    },
    terminate(gesture) {
      if (dragging) handlers?.onSeekEnd(offset(gesture.dx));
      dragging = false;
    },
    panHandlers: {},
    dispose() {
      clearTimeout(tapTimer);
    },
  };
  gestures.panHandlers = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      dragging = false;
    },
    onPanResponderMove: (_event, gesture) => gestures.move(gesture),
    onPanResponderRelease: (_event, gesture) => gestures.release(gesture),
    onPanResponderTerminate: (_event, gesture) => gestures.terminate(gesture),
  }).panHandlers;
  return gestures;
}

export function useTouchGestures(handlers: TouchHandlers): GestureResponderHandlers {
  const [gestures] = useState(createTouchGestures);
  useEffect(() => {
    gestures.setHandlers(handlers);
  });
  useEffect(() => () => gestures.dispose(), [gestures]);
  return gestures.panHandlers;
}
