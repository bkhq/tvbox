import { useCallback, useEffect, useRef } from 'react';
import { type HWEvent, Platform, useTVEventHandler } from 'react-native';

/** Constant.INTERVAL_SEEK: every left / right press (and key repeat) adds 10 s. */
export const SEEK_STEP = 10_000;
/** The accumulated seek is applied this long after the last press. */
export const SEEK_COMMIT_DELAY = 500;

export interface RemoteKeyHandlers {
  /** Controls overlay shown: D-pad keys move focus instead of seeking. */
  overlayVisible: boolean;
  /** A panel (modal) is open and owns the keys. */
  panelOpen: boolean;
  /** Any key: restarts the overlay's auto-hide timer. */
  onActivity(): void;
  /** OK / select with the overlay hidden (VideoActivity.onKeyCenter). */
  onCenter(): void;
  onPlay(): void;
  onPause(): void;
  onToggle(): void;
  /** Up (and the Android menu key): show the controls. */
  onShowControls(): void;
  /** Down: the episode panel. */
  onShowEpisodes(): void;
  onNext(): void;
  onPrev(): void;
  /** Seek preview: the accumulated offset in ms (negative = rewind). */
  onSeeking(offset: number): void;
  onSeekEnd(offset: number): void;
}

const KEY_UP = 1;

/**
 * TV remote handling, after CustomKeyDownVod: left / right seek by a step
 * that grows while the key repeats and is applied shortly after release;
 * OK pauses / resumes; up shows the controls, down the episode list; channel
 * and media next / previous keys change episode. Android reports key down (0)
 * and up (1); events without an action (tvOS gestures) count as both.
 */
export function useRemoteKeys(handlers: RemoteKeyHandlers): void {
  const handlersRef = useRef(handlers);
  const holdRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    handlersRef.current = handlers;
  });
  useEffect(() => () => clearTimeout(timerRef.current), []);

  const handle = useCallback((event: HWEvent) => {
    const h = handlersRef.current;
    if (h.panelOpen) return;
    const action = event.eventKeyAction ?? -1;
    const pressed = action !== KEY_UP;
    const released = action === KEY_UP || action === -1;
    h.onActivity();
    const seekBy = (direction: 1 | -1) => {
      holdRef.current += direction * SEEK_STEP;
      h.onSeeking(holdRef.current);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const offset = holdRef.current;
        holdRef.current = 0;
        handlersRef.current.onSeekEnd(offset);
      }, SEEK_COMMIT_DELAY);
    };
    switch (event.eventType) {
      case 'left':
      case 'right':
        if (pressed && !h.overlayVisible) seekBy(event.eventType === 'right' ? 1 : -1);
        return;
      case 'rewind':
      case 'fastForward':
        if (pressed) seekBy(event.eventType === 'fastForward' ? 1 : -1);
        return;
    }
    if (!released) return;
    switch (event.eventType) {
      case 'select':
        if (!h.overlayVisible) h.onCenter();
        return;
      case 'playPause':
        h.onToggle();
        return;
      case 'play':
        h.onPlay();
        return;
      case 'pause':
        h.onPause();
        return;
      case 'up':
        if (!h.overlayVisible) h.onShowControls();
        return;
      case 'menu':
        // tvOS: the menu key is back.
        if (Platform.OS === 'android' && !h.overlayVisible) h.onShowControls();
        return;
      case 'down':
        if (!h.overlayVisible) h.onShowEpisodes();
        return;
      case 'next':
      case 'channelDown':
        h.onNext();
        return;
      case 'previous':
      case 'channelUp':
        h.onPrev();
        return;
    }
  }, []);

  useTVEventHandler(handle);
}
