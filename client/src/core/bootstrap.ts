import { createContext, createElement, type ReactNode, useContext, useSyncExternalStore } from 'react';

import { getAppConfig } from './appConfig';
import { loadVodConfig, type VodConfig, type VodConfigPrefs } from './config';
import { resetHomeSiteOnce } from './homeReset';
import { runMigration } from './migration';
import { clearProviders } from './provider';
import { createServerLink, defaultDeviceInfo, type ServerLink, setServerLink } from './serverLink';
import { appSettings, type SettingsStore } from './settings';
import { asyncStorageStore, type ConfigRepository, createConfigRepository, type SavedConfig } from './storage';
import { installJarSpiders, onJarConfigLoaded } from '../spider/jar/install';
import { installJsSpiders } from '../spider/nativeRuntime';

/**
 * App startup: migration from the Java app (once, Android), settings, server
 * link, then the active VOD config. The CMS provider is built into the
 * provider registry, so nothing is registered here; providers cached for the
 * previous config are dropped on every load.
 */

export type VodConfigStatus = 'loading' | 'ready' | 'empty' | 'error';

export interface VodConfigSnapshot {
  status: VodConfigStatus;
  /** Loaded config; set when status is "ready". */
  config?: VodConfig;
  /** Saved entry of the active config (name, url); unset when status is "empty". */
  entry?: SavedConfig;
  /** Set when status is "error". */
  error?: Error;
}

export interface Bootstrap {
  /** Loads settings, starts the server link and loads the active config; idempotent. */
  start(): Promise<void>;
  getSnapshot(): VodConfigSnapshot;
  subscribe(listener: () => void): () => void;
  /** Reloads the active config; failures end in the "error" status. */
  reload(): Promise<void>;
  /** Saves `url`, makes it the active config and loads it. */
  addConfig(url: string): Promise<void>;
}

export interface BootstrapDeps {
  configs: ConfigRepository;
  settings: Pick<SettingsStore, 'loadSettings' | 'get'>;
  loadConfig?: (url: string, prefs: VodConfigPrefs) => Promise<VodConfig>;
  /**
   * Builds the server link around the given config loader, so subscriptions it
   * applies show up here; omit when the build has no worker URL.
   */
  createServerLink?: (loadConfig: (url: string) => Promise<unknown>) => ServerLink;
  /** One-time import of the Java app's data; awaited before anything is read. Must not reject. */
  migrate?: () => Promise<unknown>;
  /** One-time reset of the saved home site, run once the settings are loaded. */
  resetHome?: () => Promise<unknown>;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export function createBootstrap(deps: BootstrapDeps): Bootstrap {
  const { configs, settings } = deps;
  const loadConfig = deps.loadConfig ?? loadVodConfig;
  const listeners = new Set<() => void>();
  let snapshot: VodConfigSnapshot = { status: 'loading' };
  let started: Promise<void> | undefined;
  let link: ServerLink | undefined;
  /** Bumped per load so a slower, older load cannot overwrite a newer one. */
  let generation = 0;
  let activation: Promise<unknown> = Promise.resolve();

  function publish(next: VodConfigSnapshot) {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  /** Loads `url` (already saved and active); rejects on failure after publishing the error. */
  async function load(url: string, current = ++generation): Promise<VodConfig | undefined> {
    const entry = await configs.find(url);
    if (current !== generation) return undefined;
    publish({ status: 'loading', entry });
    try {
      const config = await loadConfig(url, { home: settings.get('homeSiteKey') || undefined });
      if (current !== generation) return undefined;
      // Cleanup and activation share native state; downloads can still run concurrently.
      const next = activation.then(async () => {
        if (current !== generation) return undefined;
        clearProviders();
        await onJarConfigLoaded(config, () => current === generation);
        if (current !== generation) return undefined;
        // Config.update: a successful load bumps the entry to the top of the list.
        const saved = await configs.add({ url });
        if (current !== generation) return undefined;
        publish({ status: 'ready', config, entry: saved });
        return config;
      });
      activation = next.catch(() => undefined);
      return await next;
    } catch (error) {
      if (current !== generation) return undefined;
      publish({ status: 'error', entry, error: toError(error) });
      throw error;
    }
  }

  async function reload() {
    const current = ++generation;
    const active = await configs.getActive();
    if (current !== generation) return;
    if (!active) {
      publish({ status: 'empty' });
      return;
    }
    try {
      await load(active.url, current);
    } catch (error) {
      link?.onConfigError(active.url, error);
    }
  }

  return {
    start() {
      started ??= (async () => {
        await deps.migrate?.();
        try {
          await settings.loadSettings();
          await deps.resetHome?.();
          if (deps.createServerLink) {
            link = deps.createServerLink(load);
            // Installs the device headers before the subscription URL is fetched.
            await link.init();
          }
        } catch (error) {
          publish({ status: 'error', error: toError(error) });
          return;
        }
        await reload();
      })();
      return started;
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reload,
    async addConfig(url) {
      const trimmed = url.trim();
      if (!trimmed) return;
      await configs.add({ url: trimmed });
      await configs.setActive(trimmed);
      await reload();
    },
  };
}

let shared: Bootstrap | undefined;

/**
 * App-wide bootstrap backed by AsyncStorage; also installs the app-wide server
 * link when enabled, and the QuickJS spider runtime + JS spider provider.
 */
export function getBootstrap(): Bootstrap {
  if (!shared) {
    installJsSpiders();
    installJarSpiders();
    const { workerUrl, versionName, versionCode } = getAppConfig();
    const configs = createConfigRepository(asyncStorageStore, 'vod');
    shared = createBootstrap({
      configs,
      settings: appSettings,
      migrate: () => runMigration(),
      resetHome: () => resetHomeSiteOnce(asyncStorageStore, appSettings),
      createServerLink: workerUrl
        ? (loadConfig) => {
            const link = createServerLink({
              workerUrl,
              versionName,
              versionCode,
              store: asyncStorageStore,
              configs,
              loadConfig,
              device: defaultDeviceInfo,
            });
            setServerLink(link);
            return link;
          }
        : undefined,
    });
  }
  return shared;
}

const BootstrapContext = createContext<Bootstrap | undefined>(undefined);

/** Overrides the bootstrap seen by useVodConfig (tests, previews); defaults to getBootstrap(). */
export function BootstrapProvider({ value, children }: { value: Bootstrap; children: ReactNode }) {
  return createElement(BootstrapContext.Provider, { value }, children);
}

export interface UseVodConfig extends VodConfigSnapshot {
  reload(): Promise<void>;
  addConfig(url: string): Promise<void>;
}

/** Active VOD config state; re-renders on every load. */
export function useVodConfig(): UseVodConfig {
  const bootstrap = useContext(BootstrapContext) ?? getBootstrap();
  const snapshot = useSyncExternalStore(bootstrap.subscribe, bootstrap.getSnapshot);
  return { ...snapshot, reload: bootstrap.reload, addConfig: bootstrap.addConfig };
}
