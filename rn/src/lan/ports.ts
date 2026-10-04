/**
 * How the LAN core reaches the rest of the app. Every port is optional: the server answers
 * before the player, remote, navigation and source workstreams have wired theirs in.
 */

export interface LanPlayerState {
  active: boolean;
  playing: boolean;
  title: string;
  /** Milliseconds. */
  position: number;
  /** Milliseconds. */
  duration: number;
  speed: number;
  url?: string;
  artwork?: string;
}

export interface LanPlayOptions {
  title?: string;
  /** Start position in milliseconds. */
  position?: number;
  headers?: Record<string, string>;
}

export interface LanPlayer {
  getState(): LanPlayerState;
  play(): void;
  pause(): void;
  stop(): void;
  prev(): void;
  next(): void;
  repeat(): void;
  replay(): void;
  seekTo(ms: number): void;
  setSpeed(speed: number): void;
  playUrl(url: string, options?: LanPlayOptions): void;
}

export type LanKey = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | 'menu';
export type LanVolume = 'up' | 'down' | 'mute';

export interface LanRemote {
  /** Resolves false when the app is not in the foreground. */
  sendKey(key: LanKey): Promise<boolean>;
  /** Resolves false when no text input has focus. */
  sendText(text: string): Promise<boolean>;
  adjustVolume(direction: LanVolume): Promise<boolean>;
}

export interface LanNavigator {
  search(word: string): void;
  openPlayer?(): void;
}

export interface LanSourceItem {
  key: string;
  name: string;
}

export interface LanSources {
  lives(): LanSourceItem[];
  currentLive(): string;
  setLive(name: string): boolean;
  parses(): LanSourceItem[];
  currentParse(): string;
  setParse(name: string): boolean;
  clearCache?(): Promise<void>;
  /** Human readable, e.g. "12 MB". */
  cacheSize?(): Promise<string>;
  backup?(): Promise<boolean>;
}

export interface LanEnv {
  version: string;
  /** http://<lan ip>:<port> */
  address(): string;
}

export interface LanPorts {
  player: LanPlayer | null;
  remote: LanRemote | null;
  navigator: LanNavigator | null;
  sources: LanSources | null;
  env: LanEnv | null;
}

const emptyPorts = (): LanPorts => ({ player: null, remote: null, navigator: null, sources: null, env: null });

let ports: LanPorts = emptyPorts();

/** Installs or replaces ports; pass null to remove one. */
export function setLanPorts(partial: Partial<LanPorts>): void {
  ports = { ...ports, ...partial };
}

export function getLanPorts(): LanPorts {
  return ports;
}

/** Test helper: back to no ports. */
export function resetLanPorts(): void {
  ports = emptyPorts();
}
