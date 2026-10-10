import { createContext, createElement, type ReactNode, useContext, useSyncExternalStore } from 'react';

import { getAppConfig } from './appConfig';
import { loadVodConfig, type VodConfig, type VodConfigPrefs } from './config';
import { clearProviders } from './provider';
import { createServerLink, defaultDeviceInfo, type ServerLink, setServerLink } from './serverLink';
import { appSettings, type SettingsStore } from './settings';
import { asyncStorageStore, type ConfigRepository, createConfigRepository, type SavedConfig } from './storage';
import { installJarSpiders, onJarConfigLoaded } from '../spider/jar/install';
import { installJsSpiders } from '../spider/nativeRuntime';

/**
 * App startup: settings, server link, then the active VOD config. The CMS
 * provider is built into the provider registry, so nothing is registered
 * here; providers cached for the previous config are dropped on every load.
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

  function publish(next: VodConfigSnapshot) {
    snapshot = next;
    for (const listener of [...listeners]) listener();
  }

  /** Loads `url` (already saved and active); rejects on failure after publishing the error. */
  async function load(url: string): Promise<VodConfig | undefined> {
    const current = ++generation;
    const entry = await configs.find(url);
    publish({ status: 'loading', entry });
    try {
      const config = await loadConfig(url, { home: settings.get('homeSiteKey') || undefined });
      if (current !== generation) return undefined;
      clearProviders();
      await onJarConfigLoaded(config);
      // Config.update: a successful load bumps the entry to the top of the list.
      const saved = await configs.add({ url });
      publish({ status: 'ready', config, entry: saved });
      return config;
    } catch (error) {
      if (current === generation) publish({ status: 'error', entry, error: toError(error) });
      throw error;
    }
  }

  async function reload() {
    const active = await configs.getActive();
    if (!active) {
      generation++;
      publish({ status: 'empty' });
      return;
    }
    try {
      await load(active.url);
    } catch (error) {
      link?.onConfigError(active.url, error);
    }
  }

  return {
    start() {
      started ??= (async () => {
        try {
          await settings.loadSettings();
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
