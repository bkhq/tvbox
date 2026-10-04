import { useCallback, useEffect, useRef } from 'react';
import { type HWEvent, Platform, useTVEventHandler } from 'react-native';

export type LiveRemoteAction =
  | { type: 'channel'; key: 'up' | 'down' }
  | { type: 'step'; delta: 1 | -1 }
  | { type: 'line'; next: boolean }
  | { type: 'list' }
  | { type: 'menu' }
  | { type: 'toggle' }
  | { type: 'play' }
  | { type: 'pause' };

const KEY_UP = 1;

/**
 * CustomKeyDownLive: up / down (and channel up / down) change channel through
 * the `invert` setting, media next / previous step directly, left / right
 * switch source, OK opens the channel list, menu / info the live panel.
 * react-native-tvos reports no digit keys, so channel numbers cannot be typed.
 */
export function liveRemoteAction(eventType: string): LiveRemoteAction | undefined {
  switch (eventType) {
    case 'up':
    case 'channelUp':
      return { type: 'channel', key: 'up' };
    case 'down':
    case 'channelDown':
      return { type: 'channel', key: 'down' };
    case 'next':
      return { type: 'step', delta: 1 };
    case 'previous':
      return { type: 'step', delta: -1 };
    case 'left':
    case 'right':
      return { type: 'line', next: eventType === 'right' };
    case 'select':
      return { type: 'list' };
    case 'info':
      return { type: 'menu' };
    case 'menu':
      // tvOS: the menu key is back.
      return Platform.OS === 'android' ? { type: 'menu' } : undefined;
    case 'playPause':
      return { type: 'toggle' };
    case 'play':
      return { type: 'play' };
    case 'pause':
      return { type: 'pause' };
  }
  return undefined;
}

/**
 * Remote keys over the video; ignored while the channel list or a panel owns
 * focus. Acts on key up (Android) or action-less events (tvOS).
 */
export function useLiveRemote(blocked: boolean, onAction: (action: LiveRemoteAction) => void): void {
  const ref = useRef({ blocked, onAction });
  useEffect(() => {
    ref.current = { blocked, onAction };
  });
  const handle = useCallback((event: HWEvent) => {
    const current = ref.current;
    if (current.blocked) return;
    const action = event.eventKeyAction ?? -1;
    if (action !== KEY_UP && action !== -1) return;
    const mapped = liveRemoteAction(event.eventType);
    if (mapped) current.onAction(mapped);
  }, []);
  useTVEventHandler(handle);
}
