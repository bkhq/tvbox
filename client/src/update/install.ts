/**
 * Platform-branched install with injectable side effects (see native.ts for
 * the real ones). Android downloads the APK and hands it to the system
 * installer; iOS opens the itms-services URL; tvOS has no over-the-air
 * ad-hoc install, so the user is told to have the build reinstalled.
 *
 * Like the Java updater, the downloaded APK is checked against the manifest:
 * its size when stated, then its SHA-256 (hashed natively by the Migrate
 * module) when the manifest sha256 is non-empty. If the native hash is
 * unavailable only the size is checked. The Android installer still rejects
 * an APK whose signature does not match the installed app. A verified APK of
 * the same release left from an earlier attempt is reused instead of
 * downloading it again.
 */

import { itmsServicesUrl, type Release } from './logic';

export interface DownloadedApk {
  size: number;
  /** content:// URI readable by the installer. */
  contentUri: string;
  /** Lowercase hex SHA-256 of the file; absent when no native hash is available. */
  sha256?(): Promise<string>;
  discard(): void;
}

export interface DownloadProgress {
  bytes: number;
  /** Null when the server does not state the size. */
  total: number | null;
}

export interface InstallDeps {
  /** The APK kept under `name` by an earlier download, or null. */
  cachedApk(name: string): DownloadedApk | null;
  downloadApk(
    url: string,
    name: string,
    onProgress: (progress: DownloadProgress) => void,
    signal?: AbortSignal,
  ): Promise<DownloadedApk>;
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

export class ChecksumMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`APK sha256 mismatch: expected ${expected}, got ${actual}`);
    this.name = 'ChecksumMismatchError';
  }
}

export interface InstallOptions {
  onProgress?: (progress: DownloadProgress) => void;
  /** Called before the size / checksum check of a downloaded or cached APK. */
  onVerifying?: () => void;
  /** Called once the APK is verified, before the installer opens. */
  onDownloaded?: () => void;
  signal?: AbortSignal;
}

/** Cache file name of a release's APK; the version code prefix lets old ones be cleaned up. */
export function apkCacheName(release: Pick<Release, 'versionCode' | 'flavor'>): string {
  return `${release.versionCode}-${release.flavor}.apk`;
}

/** The mismatch found in `apk`, or null when it matches the manifest. */
async function checkApk(release: Release, apk: DownloadedApk): Promise<Error | null> {
  if (release.size !== undefined && apk.size !== release.size) return new SizeMismatchError(release.size, apk.size);
  if (!release.sha256) return null;
  if (!apk.sha256) {
    console.warn('[update] native sha256 unavailable; verified APK size only');
    return null;
  }
  const actual = await apk.sha256();
  return actual.toLowerCase() === release.sha256.toLowerCase() ? null : new ChecksumMismatchError(release.sha256, actual);
}

export async function installUpdate(release: Release, deps: InstallDeps, options: InstallOptions = {}): Promise<InstallResult> {
  const { onProgress = () => {}, onVerifying, onDownloaded, signal } = options;
  switch (release.flavor) {
    case 'leanback-arm64_v8a':
    case 'leanback-armeabi_v7a': {
      const name = apkCacheName(release);
      let apk = deps.cachedApk(name);
      if (apk) {
        onVerifying?.();
        if (await checkApk(release, apk)) {
          apk.discard();
          apk = null;
        }
      }
      if (!apk) {
        apk = await deps.downloadApk(release.binaryUrl, name, onProgress, signal);
        onVerifying?.();
        const mismatch = await checkApk(release, apk);
        if (mismatch) {
          apk.discard();
          throw mismatch;
        }
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
