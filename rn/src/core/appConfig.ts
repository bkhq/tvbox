import Constants from 'expo-constants';

import { normalizeWorkerUrl } from './workerUrl';

export interface AppConfig {
  /** Worker base URL baked in at build time from WORKER_URL; "" when unset. */
  workerUrl: string;
  versionName: string;
  versionCode: number;
}

export function getAppConfig(): AppConfig {
  const expoConfig = Constants.expoConfig;
  const extra = expoConfig?.extra as { workerUrl?: unknown } | undefined;
  return {
    workerUrl: normalizeWorkerUrl(typeof extra?.workerUrl === 'string' ? extra.workerUrl : undefined),
    versionName: expoConfig?.version ?? '0.0.0',
    versionCode: expoConfig?.android?.versionCode ?? 0,
  };
}
