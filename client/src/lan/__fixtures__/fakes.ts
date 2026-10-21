import type { Bootstrap, VodConfigSnapshot } from '../../core/bootstrap';
import type { VodConfig } from '../../core/config/vodConfig';
import type { ServerLink, ServerLinkSnapshot } from '../../core/serverLink/serverLink';
import { createSettingsStore } from '../../core/settings/settings';
import { createConfigRepository } from '../../core/storage/configs';
import { MemoryStore } from '../../core/storage/keyValueStore';
import type { Site } from '../../core/types';
import { createPairing } from '../pairing';
import type { LanCatalog, LanDetail, LanLibraryItem, LanPlayer, LanPlayerState, LanPorts, LanSearchSnapshot } from '../ports';
import { createLanServer } from '../server';
import type { LanRequest } from '../types';

/** Deterministic byte source: counts up from `seed`. */
export function counterBytes(seed = 0) {
  let next = seed;
  return (n: number) => Uint8Array.from({ length: n }, () => next++ & 0xff);
}

export function request(path: string, init: Partial<LanRequest> = {}): LanRequest {
  return {
    id: '1',
    method: 'GET',
    path,
    query: {},
    form: {},
    files: {},
    headers: {},
    body: '',
    remoteAddress: '192.168.1.20',
    ...init,
  };
}

export function site(key: string, supported = true): Site {
  return {
    key,
    name: `Site ${key}`,
    type: 1,
    api: `https://${key}.example/api`,
    ext: '',
    click: '',
    playUrl: '',
    searchable: 1,
    quickSearch: 1,
    changeable: 1,
    hide: 0,
    indexs: 0,
    timeout: 15000,
    categories: [],
    header: {},
    supported,
  };
}

export function fakePlayer(state: Partial<LanPlayerState> = {}) {
  const current: LanPlayerState = { active: true, playing: true, title: 'Movie', position: 10_000, duration: 60_000, speed: 1, ...state };
  const player = {
    getState: jest.fn(() => current),
    play: jest.fn(),
    pause: jest.fn(),
    stop: jest.fn(),
    prev: jest.fn(),
    next: jest.fn(),
    repeat: jest.fn(),
    replay: jest.fn(),
    seekTo: jest.fn(),
    setSpeed: jest.fn(),
    playUrl: jest.fn(),
  } satisfies LanPlayer;
  return { player, state: current };
}

export const fakeDetail: LanDetail = {
  site: { key: 'a', name: 'Site a' },
  vod: { id: 'v1', name: 'Movie', pic: 'https://img.example/v1.jpg', remarks: '更新至2集', year: '2024', type: '剧集', area: '', director: '', actor: '', content: '' },
  flags: [
    { flag: 'line1', episodes: [{ name: '第1集', url: 'e1' }, { name: '第2集', url: 'e2' }] },
    { flag: 'line2', episodes: [{ name: '第1集', url: 'f1' }] },
  ],
};

/** Catalog whose search answers a fixed snapshot and whose detail is `fakeDetail`. */
export function fakeCatalog(snapshot: Partial<LanSearchSnapshot> = {}) {
  const current: LanSearchSnapshot = { groups: [], completed: 0, total: 2, done: false, ...snapshot };
  const session = { snapshot: jest.fn(() => current), cancel: jest.fn() };
  const catalog = {
    search: jest.fn(() => session),
    detail: jest.fn(async () => fakeDetail),
    history: jest.fn(async (): Promise<LanLibraryItem[]> => []),
    keeps: jest.fn(async (): Promise<LanLibraryItem[]> => []),
    words: jest.fn(async () => ({ history: ['繁花'], hot: ['三体'] })),
  } satisfies LanCatalog;
  return { catalog, session, snapshot: current };
}

export function fakeServerLink(enabled = true, snapshot: Partial<ServerLinkSnapshot> = {}) {
  return {
    isEnabled: () => enabled,
    init: jest.fn(async () => undefined),
    getSnapshot: () => ({ state: 'PENDING', code: 'ABCD-EFGH', subscription: '', ...snapshot }) as ServerLinkSnapshot,
    subscribe: () => () => undefined,
    request: jest.fn(async () => undefined),
    refresh: jest.fn(async () => undefined),
    unlink: jest.fn(async () => undefined),
    onConfigError: jest.fn(),
    dispose: jest.fn(),
  } satisfies ServerLink;
}

/** Server on a MemoryStore; requests come from 127.0.0.1 unless a test says otherwise. */
export async function setup(options: { ports?: Partial<LanPorts>; sites?: Site[]; serverLink?: ServerLink; now?: () => number } = {}) {
  const store = new MemoryStore();
  let time = 1_000_000;
  const now = options.now ?? (() => time);
  const pairing = createPairing({ store, randomBytes: counterBytes(), now });
  const settings = createSettingsStore(store);
  const vod = createConfigRepository(store, 'vod', now);
  const live = createConfigRepository(store, 'live', now);
  const sites = options.sites ?? [site('a'), site('b'), site('jar', false)];
  const config = { url: 'https://vod.example/a.json', sites, home: sites[0], parses: [], lives: [] } as unknown as VodConfig;
  let snapshot: VodConfigSnapshot = { status: 'ready', config };
  const bootstrap = {
    getSnapshot: () => snapshot,
    addConfig: jest.fn<Promise<void>, [string]>(async (url) => {
      await vod.add({ url });
      await vod.setActive(url);
    }),
  } satisfies Pick<Bootstrap, 'getSnapshot' | 'addConfig'>;
  const ports: LanPorts = { player: null, remote: null, navigator: null, sources: null, catalog: null, env: null, ...options.ports };
  const server = createLanServer({
    pairing,
    ports: () => ports,
    settings,
    configs: { vod, live },
    bootstrap,
    serverLink: () => options.serverLink,
  });
  await pairing.ready;
  return {
    store,
    pairing,
    settings,
    vod,
    live,
    bootstrap,
    ports,
    server,
    setSnapshot: (next: VodConfigSnapshot) => (snapshot = next),
    advance: (ms: number) => (time += ms),
    call: (path: string, params: Record<string, string> = {}, init: Partial<LanRequest> = {}) =>
      server.handle(request(path, { remoteAddress: '127.0.0.1', query: params, ...init })),
  };
}

export const bodyJson = (res: { body?: string }) => JSON.parse(res.body ?? '') as Record<string, unknown>;
