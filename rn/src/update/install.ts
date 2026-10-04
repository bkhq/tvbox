/**
 * Platform-branched install with injectable side effects (see native.ts for
 * the real ones). Android downloads the APK and hands it to the system
 * installer; iOS opens the itms-services URL; tvOS has no over-the-air
 * ad-hoc install, so the user is told to have the build reinstalled.
 *
 * Only the APK size is verified: no installed API can SHA-256 a file
 * natively (expo-file-system only offers MD5), and hashing in JS would read
 * the whole APK through the bridge. The Android installer still rejects an
 * APK whose signature does not match the installed app.
 */

import { itmsServicesUrl, type Release } from './logic';

export interface DownloadedApk {
  size: number;
  /** content:// URI readable by the installer. */
  contentUri: string;
  discard(): void;
}

export interface InstallDeps {
  downloadApk(url: string, onProgress: (fraction: number | null) => void, signal?: AbortSignal): Promise<DownloadedApk>;
  launchInstaller(contentUri: string): Promise<void>;
  openURL(url: string): Promise<void>;
}

export type InstallResult = { status: 'started' } | { status: 'manual'; reason: 'tvos' | 'cannot-open' };

export class SizeMismatchError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`APK size mismatch: expected ${expected}, got ${actual}`);
    this.name = 'SizeMismatchError';
  }
}

export interface InstallOptions {
  onProgress?: (fraction: number | null) => void;
  /** Called once the APK is verified, before the installer opens. */
  onDownloaded?: () => void;
  signal?: AbortSignal;
}

export async function installUpdate(release: Release, deps: InstallDeps, options: InstallOptions = {}): Promise<InstallResult> {
  const { onProgress = () => {}, onDownloaded, signal } = options;
  switch (release.flavor) {
    case 'android-universal': {
      const apk = await deps.downloadApk(release.binaryUrl, onProgress, signal);
      if (apk.size !== release.size) {
        apk.discard();
        throw new SizeMismatchError(release.size, apk.size);
      }
      onDownloaded?.();
      await deps.launchInstaller(apk.contentUri);
      return { status: 'started' };
    }
    case 'ios-universal': {
      if (!release.plistUrl) return { status: 'manual', reason: 'cannot-open' };
      const url = itmsServicesUrl(release.plistUrl);
      // openURL rejects when nothing handles the URL. canOpenURL is not used:
      // it reports false unless itms-services is in LSApplicationQueriesSchemes.
      try {
        await deps.openURL(url);
      } catch {
        return { status: 'manual', reason: 'cannot-open' };
      }
      return { status: 'started' };
    }
    case 'tvos-universal':
      return { status: 'manual', reason: 'tvos' };
  }
}
