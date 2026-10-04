import Constants from 'expo-constants';

import { HttpError, request } from '../../http';
import { createConfigRepository, MemoryStore } from '../../storage';
import { DEVICE_ID_KEY, getDeviceId, newDeviceId } from '../deviceId';
import {
  createServerLink,
  hostOf,
  isServerLinkEnabled,
  newCode,
  POLL_INTERVAL,
  SERVER_LINK_KEY,
  type ServerLink,
  type ServerLinkDeps,
} from '../serverLink';

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { version: '1.0.0', extra: {} } },
}));

const WORKER = 'https://tvbox.example.workers.dev';
const ENROLL = `${WORKER}/api/raw/tvbox/enroll`;
const SUB_A = `${WORKER}/s/tokenA/api.json`;
const SUB_B = `${WORKER}/s/tokenB/api.json`;
const CODE = /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/;

type Reply = Record<string, unknown>;

/** Fetch mock answering enroll posts from a queue (last reply repeats) and anything else with 200. */
function workerFetch(...replies: Reply[]) {
  const queue = [...replies];
  return jest.fn(async (url: string, _init?: RequestInit) => {
    const body = url === ENROLL ? (queue.length > 1 ? queue.shift() : queue[0]) : {};
    return { ok: true, status: 200, url, text: async () => JSON.stringify(body) } as Response;
  });
}

function setup(fetch: ReturnType<typeof workerFetch>, overrides: Partial<ServerLinkDeps> = {}) {
  const store = new MemoryStore();
  const configs = createConfigRepository(store, 'vod');
  const loadConfig = jest.fn(async (_url: string): Promise<unknown> => ({}));
  let time = 1_000_000;
  const deps: ServerLinkDeps = {
    workerUrl: WORKER,
    versionName: '1.1.0',
    versionCode: 10100,
    store,
    configs,
    loadConfig,
    device: () => ({ name: '客厅', model: 'Xiaomi MiBOX4', mode: 'leanback', abi: '' }),
    fetch,
    now: () => time,
    ...overrides,
  };
  const link = createServerLink(deps);
  links.push(link);
  return { link, store, configs, loadConfig, tick: (ms: number) => (time += ms) };
}

function enrollBodies(fetch: ReturnType<typeof workerFetch>): Reply[] {
  return fetch.mock.calls.filter(([url]) => url === ENROLL).map(([, init]) => JSON.parse(String(init?.body)) as Reply);
}

const links: ServerLink[] = [];

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  links.splice(0).forEach((link) => link.dispose());
  jest.useRealTimers();
});

describe('codes and ids', () => {
  it('generates XXXX-XXXX device codes', () => {
    for (let i = 0; i < 50; i++) expect(newCode()).toMatch(CODE);
    expect(newCode(() => new Uint8Array(16).fill(255).map((v, i) => (i < 2 ? v : i)))).toBe('CDEF-GHJK');
  });

  it('generates a locally administered MAC-style device id and persists it', async () => {
    expect(newDeviceId(() => Uint8Array.from([0xff, 1, 2, 3, 4, 0xab]))).toBe('FE:01:02:03:04:AB');
    const store = new MemoryStore();
    const id = await getDeviceId(store);
    expect(id).toMatch(/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/);
    expect(await getDeviceId(store)).toBe(id);
    expect(store.data.get(DEVICE_ID_KEY)).toBe(id);
  });

  it('extracts host names', () => {
    expect(hostOf('https://User@Tvbox.Example.com:8443/a?b')).toBe('tvbox.example.com');
    expect(hostOf('/relative')).toBe('');
  });
});

describe('server link', () => {
  it('is disabled when the worker URL is empty', async () => {
    expect(isServerLinkEnabled()).toBe(false);
    (Constants.expoConfig as { extra: Record<string, unknown> }).extra.workerUrl = WORKER;
    expect(isServerLinkEnabled()).toBe(true);

    const fetch = workerFetch({ status: 'pending' });
    const { link } = setup(fetch, { workerUrl: '' });
    expect(link.isEnabled()).toBe(false);
    await link.request();
    expect(fetch).not.toHaveBeenCalled();
    expect(link.getSnapshot().state).toBe('OFF');
  });

  it('requests, polls while pending and applies the approval', async () => {
    const fetch = workerFetch({ status: 'pending' }, { status: 'pending' }, { status: 'approved', subscription: SUB_A, deviceKey: 'key-1' });
    const { link, store, configs, loadConfig } = setup(fetch);
    const changes = jest.fn();
    link.subscribe(changes);

    await link.init();
    const code = link.getSnapshot().code;
    expect(code).toMatch(CODE);
    expect(link.getSnapshot().state).toBe('OFF');

    await link.request();
    expect(link.getSnapshot()).toEqual({ state: 'PENDING', code, subscription: '' });
    const deviceId = await getDeviceId(store);
    expect(enrollBodies(fetch)).toEqual([
      {
        action: 'request',
        code,
        deviceId,
        name: '客厅',
        model: 'Xiaomi MiBOX4',
        mode: 'leanback',
        abi: '',
        versionCode: 10100,
        versionName: '1.1.0',
      },
    ]);
    expect(fetch.mock.calls[0]?.[1]?.method).toBe('POST');

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL - 1);
    expect(enrollBodies(fetch)).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(enrollBodies(fetch)).toHaveLength(2);
    expect(link.getSnapshot().state).toBe('PENDING');

    await jest.advanceTimersByTimeAsync(POLL_INTERVAL);
    expect(link.getSnapshot()).toEqual({ state: 'LINKED', code, subscription: SUB_A });
    expect((await configs.getActive())?.url).toBe(SUB_A);
    expect(loadConfig).toHaveBeenCalledWith(SUB_A);
    expect(JSON.parse(store.data.get(SERVER_LINK_KEY) ?? '{}')).toMatchObject({ enabled: true, subscription: SUB_A, deviceKey: 'key-1' });
    expect(changes).toHaveBeenCalled();

    // Polling stops once linked.
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL * 3);
    expect(enrollBodies(fetch)).toHaveLength(3);

    // Device headers go to the worker host only.
    await request(`${WORKER}/s/tokenA/api.json`, { fetch });
    await request('https://other.example.com/api.json', { fetch });
    const headers = (url: string) => fetch.mock.calls.filter(([u]) => u === url).at(-1)?.[1]?.headers as Record<string, string>;
    expect(headers(SUB_A)).toMatchObject({ 'X-Device-Id': deviceId, 'X-Device-Key': 'key-1' });
    expect(headers('https://other.example.com/api.json')).not.toHaveProperty('X-Device-Key');
  });

  it('resumes from persisted state without reloading an unchanged subscription', async () => {
    const fetch = workerFetch({ status: 'approved', subscription: SUB_A, deviceKey: 'key-1' });
    const { link, store, loadConfig } = setup(fetch);
    await link.request();
    link.dispose();
    loadConfig.mockClear();

    const again = createServerLink({
      workerUrl: WORKER,
      versionName: '1.1.0',
      versionCode: 10100,
      store,
      configs: createConfigRepository(store, 'vod'),
      loadConfig,
      device: () => ({ name: '', model: '', mode: 'mobile', abi: '' }),
      fetch,
    });
    links.push(again);
    await again.init();
    await jest.advanceTimersByTimeAsync(0);
    expect(again.getSnapshot().state).toBe('LINKED');
    expect(enrollBodies(fetch)).toHaveLength(2);
    expect(loadConfig).not.toHaveBeenCalled();
    await request(SUB_A, { fetch });
    expect(fetch.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ 'X-Device-Key': 'key-1' });
  });

  it('turns off when the request is rejected', async () => {
    const fetch = workerFetch({ status: 'pending' }, { status: 'rejected' });
    const { link } = setup(fetch);
    await link.request();
    expect(link.getSnapshot().state).toBe('PENDING');
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL);
    expect(link.getSnapshot().state).toBe('OFF');
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL * 2);
    expect(enrollBodies(fetch)).toHaveLength(2);
  });

  it('keeps polling after network errors', async () => {
    const fetch = workerFetch({ status: 'pending' });
    fetch.mockRejectedValueOnce(new Error('offline'));
    const { link } = setup(fetch);
    await link.request();
    expect(link.getSnapshot().state).toBe('PENDING');
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('unlinks with a new code, stops polling and keeps the loaded config', async () => {
    const fetch = workerFetch({ status: 'approved', subscription: SUB_A, deviceKey: 'key-1' });
    const { link, configs } = setup(fetch);
    await link.request();
    const code = link.getSnapshot().code;

    await link.unlink();
    const snapshot = link.getSnapshot();
    expect(snapshot.state).toBe('OFF');
    expect(snapshot.code).toMatch(CODE);
    expect(snapshot.code).not.toBe(code);
    expect(enrollBodies(fetch).at(-1)).toMatchObject({ action: 'unlink', code });
    expect((await configs.getActive())?.url).toBe(SUB_A);

    await request(SUB_A, { fetch });
    expect(fetch.mock.calls.at(-1)?.[1]?.headers).not.toHaveProperty('X-Device-Key');
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL * 2);
    expect(enrollBodies(fetch)).toHaveLength(2);
  });

  it('stops polling a pending request on unlink', async () => {
    const fetch = workerFetch({ status: 'pending' });
    const { link } = setup(fetch);
    await link.request();
    await link.unlink();
    await jest.advanceTimersByTimeAsync(POLL_INTERVAL * 2);
    expect(enrollBodies(fetch).map((body) => body.action)).toEqual(['request', 'unlink']);
  });

  it('refresh switches to a changed subscription', async () => {
    const fetch = workerFetch({ status: 'approved', subscription: SUB_A, deviceKey: 'key-1' }, { status: 'approved', subscription: SUB_B });
    const { link, configs, loadConfig } = setup(fetch);
    await link.request();
    await link.refresh();
    expect(link.getSnapshot().subscription).toBe(SUB_B);
    expect((await configs.getActive())?.url).toBe(SUB_B);
    expect(loadConfig).toHaveBeenLastCalledWith(SUB_B);
    await request(SUB_B, { fetch });
    expect(fetch.mock.calls.at(-1)?.[1]?.headers).toMatchObject({ 'X-Device-Key': 'key-1' });
  });

  it('refresh reloads an unchanged subscription and does nothing when off', async () => {
    const fetch = workerFetch({ status: 'approved', subscription: SUB_A });
    const { link, loadConfig } = setup(fetch);
    await link.refresh();
    expect(fetch).not.toHaveBeenCalled();
    await link.request();
    await link.refresh();
    expect(loadConfig).toHaveBeenCalledTimes(2);
    expect(loadConfig).toHaveBeenLastCalledWith(SUB_A);
  });

  it('re-queries on a 404 of the linked subscription at most once a minute', async () => {
    const fetch = workerFetch({ status: 'approved', subscription: SUB_A, deviceKey: 'key-1' });
    const { link, loadConfig, tick } = setup(fetch);
    await link.request();
    const notFound = new HttpError(404, SUB_A);

    link.onConfigError(SUB_A, notFound);
    await jest.advanceTimersByTimeAsync(0);
    expect(enrollBodies(fetch)).toHaveLength(2);
    expect(loadConfig).toHaveBeenCalledTimes(2);

    tick(30_000);
    link.onConfigError(SUB_A, notFound);
    link.onConfigError(SUB_A, new HttpError(500, SUB_A));
    link.onConfigError(SUB_B, notFound);
    await jest.advanceTimersByTimeAsync(0);
    expect(enrollBodies(fetch)).toHaveLength(2);

    tick(30_000);
    link.onConfigError(SUB_A, notFound);
    await jest.advanceTimersByTimeAsync(0);
    expect(enrollBodies(fetch)).toHaveLength(3);
  });

  it('re-queries when loading the approved subscription returns 404', async () => {
    const fetch = workerFetch({ status: 'approved', subscription: SUB_A });
    const { link, loadConfig } = setup(fetch);
    loadConfig.mockRejectedValue(new HttpError(404, SUB_A));
    await link.request();
    await jest.advanceTimersByTimeAsync(0);
    // The approval, then one re-query; the next 404 is rate limited.
    expect(enrollBodies(fetch)).toHaveLength(2);
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });
});
