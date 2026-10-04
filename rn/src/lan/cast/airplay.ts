import airplayModule, { type AirPlayCastEvent, type AirPlayModule } from '../../../modules/airplay';
import type { SettingsStore } from '../../core/settings';
import type { LanPlayer } from '../ports';

export const DEFAULT_AIRPLAY_NAME = 'tvbox';
const PUSH_INTERVAL_MS = 1000;

export interface AirPlayDeps {
  /** Defaults to the native module (null off Android). */
  module?: AirPlayModule;
  getPlayer: () => LanPlayer | null;
  settings: Pick<SettingsStore, 'get' | 'subscribeKey'>;
}

const warn = (error: unknown) => console.warn('AirPlay:', error);

/**
 * Runs the AirPlay receiver while the `airplay` setting is on, under `airplayName`, and routes
 * HLS casts to the LAN player. Inert off Android TV. Returns a function that stops everything.
 */
export function startAirPlay(deps: AirPlayDeps): () => void {
  const module = deps.module ?? airplayModule;
  if (!module.isSupported()) return () => {};
  const { settings, getPlayer } = deps;

  let running: string | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;

  const push = () => {
    const state = getPlayer()?.getState();
    if (!state) return;
    module.updatePlayback({ position: state.position, duration: state.duration, playing: state.playing, rate: state.speed });
  };

  const startPush = () => {
    push();
    timer ??= setInterval(push, PUSH_INTERVAL_MS);
  };

  const stopPush = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const sync = () => {
    if (settings.get('airplay')) {
      const name = settings.get('airplayName').trim() || DEFAULT_AIRPLAY_NAME;
      if (running === name) return;
      running = name;
      module.start({ name }).catch(warn);
    } else if (running !== null) {
      running = null;
      stopPush();
      module.stop().catch(warn);
    }
  };

  const onCast = (event: AirPlayCastEvent) => {
    const player = getPlayer();
    if (event.type === 'stop') stopPush();
    if (!player) return;
    switch (event.type) {
      case 'play':
        player.playUrl(event.url, { position: event.position });
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
  const unsubscribe = [settings.subscribeKey('airplay', sync), settings.subscribeKey('airplayName', sync)];
  sync();

  return () => {
    for (const off of unsubscribe) off();
    subscription.remove();
    stopPush();
    if (running !== null) module.stop().catch(warn);
    running = null;
  };
}
