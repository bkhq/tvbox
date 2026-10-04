import { getRandomBytes } from 'expo-crypto';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { getAppConfig } from '../appConfig';
import { loadVodConfig } from '../config';
import { addRequestInterceptor, type FetchLike, HttpError, mergeHeaders, request as httpRequest } from '../http';
import {
  asyncStorageStore,
  type ConfigRepository,
  createConfigRepository,
  jsonCell,
  type KeyValueStore,
  storageKey,
} from '../storage';
import { isObject, str } from '../types';
import { getDeviceId, type RandomBytes } from './deviceId';

/**
 * Optional link between this device and the worker (Enroll.java). The user requests it; the
 * device shows a random code that the admin approves in the console. The approved response
 * carries the device's subscription URL, which is saved and loaded as the active VOD config.
 */

export type ServerLinkState = 'OFF' | 'PENDING' | 'LINKED';

export interface ServerLinkSnapshot {
  state: ServerLinkState;
  /** Device code shown to the user, "XXXX-XXXX"; "" until init() has run. */
  code: string;
  /** Approved subscription URL; "" unless LINKED. */
  subscription: string;
}

export interface DeviceInfo {
  name: string;
  model: string;
  mode: 'leanback' | 'mobile';
  abi: string;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface ServerLinkDeps {
  workerUrl: string;
  versionName: string;
  versionCode: number;
  store: KeyValueStore;
  configs: ConfigRepository;
  /** Loads a subscription as the VOD config; rejections with HttpError 404 trigger a re-query. */
  loadConfig: (url: string) => Promise<unknown>;
  device: () => DeviceInfo;
  fetch?: FetchLike;
  timers?: Timers;
  now?: () => number;
  random?: RandomBytes;
}

export interface ServerLink {
  isEnabled(): boolean;
  /** Loads the persisted state, installs the device headers and resumes polling; idempotent. */
  init(): Promise<void>;
  getSnapshot(): ServerLinkSnapshot;
  subscribe(listener: () => void): () => void;
  /** Turns the link on and asks the worker; resolves after the first answer. */
  request(): Promise<void>;
  /** Re-queries right away when LINKED or PENDING; reloads the config even if unchanged. */
  refresh(): Promise<void>;
  /** Tells the worker, turns the link off and rolls a new code; the loaded config stays. */
  unlink(): Promise<void>;
  /** Call when loading `url` failed; a 404 on the linked subscription re-queries, at most once a minute. */
  onConfigError(url: string, error: unknown): void;
  /** Stops polling and removes the request interceptor. */
  dispose(): void;
}

export const SERVER_LINK_KEY = storageKey('serverLink', 1);
export const POLL_INTERVAL = 15_000;
export const RECOVER_INTERVAL = 60_000;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const SERVER_LINK_STATE_TEXT: Record<ServerLinkState, string> = {
  OFF: '未关联',
  PENDING: '等待批准',
  LINKED: '已关联',
};

interface Persisted {
  enabled: boolean;
  code: string;
  subscription: string;
  deviceKey: string;
}

function parsePersisted(raw: unknown): Persisted {
  const json = isObject(raw) ? raw : {};
  return { enabled: json.enabled === true, code: str(json.code), subscription: str(json.subscription), deviceKey: str(json.deviceKey) };
}

/** Random "XXXX-XXXX" code from an alphabet without look-alike characters. */
export function newCode(random: RandomBytes = getRandomBytes): string {
  let code = '';
  // Rejection sampling keeps the distribution uniform over the 31 characters.
  while (code.length < 9) {
    for (const byte of random(16)) {
      if (code.length === 9) break;
      if (byte >= 248) continue;
      if (code.length === 4) code += '-';
      code += ALPHABET[byte % ALPHABET.length];
    }
  }
  return code;
}

/** Lower-cased host name of an absolute URL, without port; "" when it has none. */
export function hostOf(url: string): string {
  const match = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?(\[[^\]]*\]|[^:/?#]*)/i.exec(url);
  return match?.[1]?.toLowerCase() ?? '';
}

export function defaultDeviceInfo(): DeviceInfo {
  const constants = Platform.constants as { Manufacturer?: string; Model?: string };
  const model = Platform.OS === 'android' ? [constants.Manufacturer, constants.Model].filter(Boolean).join(' ') : '';
  return { name: Constants.deviceName ?? '', model, mode: Platform.isTV ? 'leanback' : 'mobile', abi: '' };
}

export function createServerLink(deps: ServerLinkDeps): ServerLink {
  const { workerUrl, store, configs, loadConfig } = deps;
  const timers: Timers = deps.timers ?? { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as never) };
  const now = deps.now ?? Date.now;
  const random = deps.random ?? getRandomBytes;
  const cell = jsonCell(store, SERVER_LINK_KEY, parsePersisted);
  const workerHost = hostOf(workerUrl);
  const listeners = new Set<() => void>();

  let data: Persisted = { enabled: false, code: '', subscription: '', deviceKey: '' };
  let snapshot: ServerLinkSnapshot = { state: 'OFF', code: '', subscription: '' };
  let initPromise: Promise<void> | undefined;
  let deviceId = '';
  let timer: unknown;
  let running = false;
  /** Bumped on unlink/dispose so answers to older requests are dropped. */
  let epoch = 0;
  let lastRecover = Number.NEGATIVE_INFINITY;
  let removeInterceptor: (() => void) | undefined;

  const enabled = () => workerUrl !== '';

  function emit() {
    const state: ServerLinkState = !data.enabled ? 'OFF' : data.subscription ? 'LINKED' : 'PENDING';
    snapshot = { state, code: data.code, subscription: state === 'LINKED' ? data.subscription : '' };
    for (const listener of [...listeners]) listener();
  }

  async function save(patch: Partial<Persisted>) {
    data = { ...data, ...patch };
    const next = data;
    await cell.update(() => ({ value: next, result: undefined }));
    emit();
  }

  /** Sends the device id and key with every request to the worker, so a copied subscription URL is useless elsewhere. */
  function bindDevice() {
    removeInterceptor?.();
    removeInterceptor = undefined;
    if (!data.enabled || !data.deviceKey || !workerHost) return;
    const headers = { 'X-Device-Id': deviceId, 'X-Device-Key': data.deviceKey };
    removeInterceptor = addRequestInterceptor((url, init) =>
      hostOf(url) === workerHost ? { ...init, headers: mergeHeaders(init.headers, headers) } : init,
    );
  }

  function stopTimer() {
    if (timer !== undefined) timers.clearTimeout(timer);
    timer = undefined;
  }

  async function post(action: 'request' | 'unlink', code: string): Promise<Record<string, unknown>> {
    const device = deps.device();
    const body = {
      action,
      code,
      deviceId,
      name: device.name,
      model: device.model,
      mode: device.mode,
      abi: device.abi,
      versionCode: deps.versionCode,
      versionName: deps.versionName,
    };
    const response = await httpRequest(`${workerUrl}/api/raw/tvbox/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body),
      fetch: deps.fetch,
    });
    const json = JSON.parse(await response.text()) as unknown;
    return isObject(json) ? json : {};
  }

  async function load(url: string) {
    try {
      await loadConfig(url);
    } catch (error) {
      link.onConfigError(url, error);
    }
  }

  async function apply(subscription: string, deviceKey: string, manual: boolean) {
    if (!subscription) return;
    const changed = subscription !== data.subscription;
    await save(deviceKey ? { subscription, deviceKey } : { subscription });
    bindDevice();
    if (!changed && !manual) return;
    await configs.add({ url: subscription });
    await configs.setActive(subscription);
    await load(subscription);
  }

  function retry() {
    stopTimer();
    if (!data.enabled) {
      running = false;
      return;
    }
    timer = timers.setTimeout(() => {
      timer = undefined;
      void check(false);
    }, POLL_INTERVAL);
  }

  async function check(manual: boolean) {
    if (!data.enabled) {
      running = false;
      return;
    }
    const current = epoch;
    let result: Record<string, unknown>;
    try {
      result = await post('request', data.code);
    } catch {
      result = {};
    }
    if (current !== epoch || !data.enabled) return;
    switch (result.status) {
      case 'approved':
        running = false;
        await apply(str(result.subscription), str(result.deviceKey), manual);
        break;
      case 'rejected':
        running = false;
        await save({ enabled: false, subscription: '', deviceKey: '' });
        bindDevice();
        break;
      default:
        retry();
    }
  }

  function start(): Promise<void> {
    if (!enabled() || !data.enabled || running) return Promise.resolve();
    running = true;
    return check(false);
  }

  const link: ServerLink = {
    isEnabled: enabled,
    init() {
      initPromise ??= (async () => {
        if (!enabled()) return;
        deviceId = await getDeviceId(store, random);
        data = await cell.read();
        if (!data.code) await save({ code: newCode(random) });
        else emit();
        bindDevice();
        void start();
      })();
      return initPromise;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async request() {
      if (!enabled()) return;
      await link.init();
      await save({ enabled: true });
      await start();
    },
    async refresh() {
      if (!enabled()) return;
      await link.init();
      if (!data.enabled) return;
      stopTimer();
      running = true;
      await check(true);
    },
    async unlink() {
      if (!enabled()) return;
      await link.init();
      const code = data.code;
      epoch++;
      stopTimer();
      running = false;
      await save({ enabled: false, subscription: '', deviceKey: '', code: newCode(random) });
      bindDevice();
      try {
        await post('unlink', code);
      } catch {
        // The worker also ends the link when the admin revokes it.
      }
    },
    onConfigError(url, error) {
      if (!(error instanceof HttpError) || error.status !== 404) return;
      if (!url || !data.enabled || url !== data.subscription) return;
      const time = now();
      if (time - lastRecover < RECOVER_INTERVAL) return;
      lastRecover = time;
      void link.refresh();
    },
    dispose() {
      epoch++;
      stopTimer();
      running = false;
      removeInterceptor?.();
      removeInterceptor = undefined;
      listeners.clear();
    },
  };
  return link;
}

/** True when the build carries a worker URL; the feature is hidden otherwise. */
export function isServerLinkEnabled(): boolean {
  return getAppConfig().workerUrl !== '';
}

let shared: ServerLink | undefined;

/** The app-wide link, backed by AsyncStorage and the saved VOD configs. */
export function getServerLink(): ServerLink {
  if (!shared) {
    const { workerUrl, versionName, versionCode } = getAppConfig();
    shared = createServerLink({
      workerUrl,
      versionName,
      versionCode,
      store: asyncStorageStore,
      configs: createConfigRepository(asyncStorageStore, 'vod'),
      loadConfig: (url) => loadVodConfig(url),
      device: defaultDeviceInfo,
    });
  }
  return shared;
}

/** Replaces the app-wide link, e.g. to route loaded configs into the app; disposes the old one. */
export function setServerLink(link: ServerLink): void {
  shared?.dispose();
  shared = link;
}
