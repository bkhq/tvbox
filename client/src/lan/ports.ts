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
  /** Opens the Search screen with the keyword. */
  search(word: string): void;
  /** Opens the Player on an episode of a site's vod. */
  play(params: LanPlayParams): void;
}

/** Player route params for a site's vod (RootStackParamList['Player']). */
export interface LanPlayParams {
  siteKey: string;
  vodId: string;
  flag: string;
  episodeUrl: string;
  /** Start position in milliseconds. */
  position?: number;
}

export interface LanVodSummary {
  id: string;
  name: string;
  pic: string;
  remarks: string;
  year: string;
  type: string;
}

export interface LanSearchSnapshot {
  groups: { site: LanSourceItem; list: LanVodSummary[] }[];
  /** Sites that answered, failed or timed out. */
  completed: number;
  total: number;
  done: boolean;
}

export interface LanSearchSession {
  snapshot(): LanSearchSnapshot;
  cancel(): void;
}

export interface LanEpisode {
  name: string;
  url: string;
}

export interface LanDetail {
  site: LanSourceItem;
  vod: LanVodSummary & { area: string; director: string; actor: string; content: string };
  flags: { flag: string; episodes: LanEpisode[] }[];
  /** Saved episode of the history, when its flag and url still exist. */
  resume?: { flag: string; episodeUrl: string; position: number; duration: number };
}

export interface LanLibraryItem extends LanVodSummary {
  siteKey: string;
  siteName: string;
  /** History only: the saved episode and progress in milliseconds. */
  flag?: string;
  episodeUrl?: string;
  position?: number;
  duration?: number;
  /** Epoch milliseconds of the last play or the favourite. */
  time: number;
}

/** Search, detail and user data of the active VOD config. */
export interface LanCatalog {
  search(keyword: string, quick: boolean): LanSearchSession;
  /** Rejects with LanCatalogError when the site or vod is unknown or the site is unsupported. */
  detail(siteKey: string, vodId: string): Promise<LanDetail>;
  history(): Promise<LanLibraryItem[]>;
  keeps(): Promise<LanLibraryItem[]>;
  words(): Promise<{ history: string[]; hot: string[] }>;
}

export class LanCatalogError extends Error {
  constructor(
    readonly status: 400 | 404,
    message: string,
  ) {
    super(message);
    this.name = 'LanCatalogError';
  }
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
  catalog: LanCatalog | null;
  env: LanEnv | null;
}

const emptyPorts = (): LanPorts => ({ player: null, remote: null, navigator: null, sources: null, catalog: null, env: null });

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
