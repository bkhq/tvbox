import { useEffect, useState } from 'react';
import { type GestureResponderHandlers, PanResponder, type PanResponderGestureState } from 'react-native';

/** Movement below this is a tap. */
const TAP_SLOP = 12;
/** Vertical movement that changes channel. */
export const SWIPE_DISTANCE = 60;

export interface LiveGestureHandlers {
  onTap(): void;
  /** Swipe up = next channel, down = previous. */
  onSwipe(direction: 'up' | 'down'): void;
}

type Gesture = Pick<PanResponderGestureState, 'dx' | 'dy'>;

/** Phone gestures over the live video: tap toggles the list, a vertical swipe changes channel. */
export function createLiveGestures() {
  let handlers: LiveGestureHandlers | undefined;
  const release = ({ dx, dy }: Gesture) => {
    if (Math.abs(dx) <= TAP_SLOP && Math.abs(dy) <= TAP_SLOP) handlers?.onTap();
    else if (Math.abs(dy) >= SWIPE_DISTANCE && Math.abs(dy) > Math.abs(dx)) handlers?.onSwipe(dy < 0 ? 'up' : 'down');
  };
  return {
    setHandlers(next: LiveGestureHandlers) {
      handlers = next;
    },
    release,
    panHandlers: PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderRelease: (_event, gesture) => release(gesture),
    }).panHandlers as GestureResponderHandlers,
  };
}

export function useLiveGestures(handlers: LiveGestureHandlers): GestureResponderHandlers {
  const [gestures] = useState(createLiveGestures);
  useEffect(() => {
    gestures.setHandlers(handlers);
  });
  return gestures.panHandlers;
}
