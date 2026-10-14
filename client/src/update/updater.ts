import { Platform } from 'react-native';

import { createUpdateController, type UpdateController } from './controller';
import type { CheckResult } from './logic';
import { cleanupUpdates, nativeInstallDeps } from './native';
import { getAbiFlavor } from '../../modules/migrate';
import { getAppConfig } from '../core/appConfig';
import { getJson } from '../core/http';

let controller: UpdateController | null = null;

/** The app-wide controller, created on first use from the build config. */
export function getUpdateController(): UpdateController {
  if (!controller) {
    const { workerUrl, versionCode } = getAppConfig();
    if (Platform.OS === 'android') cleanupUpdates(versionCode);
    controller = createUpdateController({
      workerUrl,
      versionCode,
      platform: { OS: Platform.OS, isTV: Platform.isTV, abi: getAbiFlavor() },
      fetchJson: (url) => getJson(url),
      install: nativeInstallDeps,
    });
  }
  return controller;
}

/** Manual check: failures resolve to `status: 'error'`; a newer release opens the dialog. */
export function checkForUpdatesNow(): Promise<CheckResult> {
  return getUpdateController().check(true);
}
