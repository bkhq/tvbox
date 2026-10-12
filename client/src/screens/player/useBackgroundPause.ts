import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

/**
 * The `background` setting for every engine: when it is off, playback pauses
 * as the app goes to the background (or becomes inactive) and stays paused
 * on return; when it is on, the engine keeps running.
 */
export function useBackgroundPause(background: boolean, pause: () => void): void {
  const pauseRef = useRef(pause);
  useEffect(() => {
    pauseRef.current = pause;
  });
  useEffect(() => {
    if (background) return;
    const subscription = AppState.addEventListener('change', (status) => {
      if (status === 'background' || status === 'inactive') pauseRef.current();
    });
    return () => subscription.remove();
  }, [background]);
}
