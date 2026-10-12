import type { Live } from '../core/types';
import { getPlaybackController, type PlaybackController } from '../player/controller';
import { loadLiveSources, saveLiveHome } from '../player/live/source';
import type { LanPlayer, LanSources } from './ports';

/** LanPlayer on the app-wide playback controller (src/player/controller.ts). */
export function createLanPlayer(controller: PlaybackController = getPlaybackController()): LanPlayer {
  return {
    getState() {
      const { active, playing, title, position, duration, speed, url } = controller.getState();
      return { active, playing, title, position, duration, speed, url };
    },
    play: () => controller.play(),
    pause: () => controller.pause(),
    stop: () => controller.stop(),
    prev: () => controller.prev(),
    next: () => controller.next(),
    repeat: () => controller.repeat(),
    replay: () => controller.replay(),
    seekTo: (ms) => controller.seekTo(ms),
    setSpeed: (speed) => controller.setSpeed(speed),
    playUrl: (url, options) => controller.playUrl(url, options),
  };
}

export interface LanLiveSources extends LanSources {
  /** Reloads the live source list (LiveConfig.load); the port answers from this cache. */
  refresh(): Promise<void>;
}

export interface LanLiveSourcesDeps {
  load?: () => Promise<{ lives: Live[]; home?: Live }>;
  saveHome?: (name: string) => Promise<void>;
}

/**
 * LanSources for live sources (LiveConfig.setHome): lists the live sources and stores the selected
 * one, which the Live screen opens next time. Parsers are not wired yet: the list is empty.
 */
export function createLanSources(deps: LanLiveSourcesDeps = {}): LanLiveSources {
  const load = deps.load ?? (() => loadLiveSources());
  const saveHome = deps.saveHome ?? ((name: string) => saveLiveHome(name));
  let lives: Live[] = [];
  let current = '';
  let generation = 0;

  return {
    async refresh() {
      const id = ++generation;
      const sources = await load();
      if (id !== generation) return;
      lives = sources.lives;
      current = sources.home?.name ?? '';
    },
    lives: () => lives.map((live) => ({ key: live.name, name: live.name })),
    currentLive: () => current,
    setLive(name) {
      if (!lives.some((live) => live.name === name)) return false;
      // A refresh still in flight must not bring back the previous home.
      generation++;
      current = name;
      saveHome(name).catch(() => undefined);
      return true;
    },
    parses: () => [],
    currentParse: () => '',
    setParse: () => false,
  };
}
