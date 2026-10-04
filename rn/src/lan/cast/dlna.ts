import dlnaModule, { type DlnaCastEvent, type DlnaModule } from '../../../modules/dlna';
import type { LanPlayer, LanPlayerState } from '../ports';

const PUSH_INTERVAL_MS = 1000;
/** A paused player this close to the duration has finished the media. */
const END_MARGIN_MS = 1000;

export type DlnaVolumeEvent = Extract<DlnaCastEvent, { type: 'volume' | 'mute' }>;

export interface DlnaDeps {
  /** Defaults to the native module (null off Android). */
  module?: DlnaModule;
  getPlayer: () => LanPlayer | null;
  /** Friendly name; empty uses the device name. */
  name: () => string;
  /** Sender volume / mute; the system stream volume is already applied natively. */
  onVolume?: (event: DlnaVolumeEvent) => void;
}

const warn = (error: unknown) => console.warn('DLNA:', error);

const hasEnded = (state: LanPlayerState) =>
  state.duration > 0 && !state.playing && state.position >= state.duration - END_MARGIN_MS;

/**
 * Runs the DLNA renderer and routes casts to the LAN player. Inert off Android TV. Returns a
 * function that stops everything.
 */
export function startDlna(deps: DlnaDeps): () => void {
  const module = deps.module ?? dlnaModule;
  if (!module.isSupported()) return () => {};
  const { getPlayer } = deps;

  let timer: ReturnType<typeof setInterval> | null = null;
  // The player may open after the first push; only a player seen active can be closed.
  let seenActive = false;

  const stopPush = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const push = () => {
    const state = getPlayer()?.getState();
    if (!state) return;
    if (state.active) seenActive = true;
    const ended = (seenActive && !state.active) || hasEnded(state);
    module.updatePlayback({
      position: state.position,
      duration: state.duration,
      playing: state.active && state.playing,
      ended,
    });
    if (ended) stopPush();
  };

  const startPush = () => {
    seenActive = false;
    timer ??= setInterval(push, PUSH_INTERVAL_MS);
  };

  const onCast = (event: DlnaCastEvent) => {
    if (event.type === 'volume' || event.type === 'mute') {
      deps.onVolume?.(event);
      return;
    }
    if (event.type === 'stop') stopPush();
    const player = getPlayer();
    if (!player) return;
    switch (event.type) {
      case 'play':
        player.playUrl(event.url, { title: event.title, position: event.position, headers: event.headers });
        startPush();
        break;
      case 'pause':
        player.pause();
        break;
      case 'resume':
        player.play();
        break;
      case 'seek':
        player.seekTo(event.position);
        break;
      case 'stop':
        player.stop();
        break;
    }
  };

  const subscription = module.addCastListener(onCast);
  module.start({ name: deps.name().trim() }).catch(warn);

  return () => {
    subscription.remove();
    stopPush();
    module.stop().catch(warn);
  };
}
