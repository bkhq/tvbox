import { Directory, File, Paths } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { Linking } from 'react-native';

import type { DownloadedApk, InstallDeps } from './install';
import { downloadFile, sha256File } from '../../modules/migrate';

const APK_MIME = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 0x1;
const DOWNLOAD_THREADS = 4;

const updatesDir = () => new Directory(Paths.cache, 'updates');

function downloadedApk(file: File): DownloadedApk {
  const hash = sha256File;
  return {
    size: file.size,
    contentUri: file.contentUri,
    sha256: hash ? () => hash(file.uri) : undefined,
    discard: () => {
      if (file.exists) file.delete();
    },
  };
}

/**
 * Deletes downloaded APKs that are no longer needed: those of this version or
 * older (an update installed), unfinished parts, and the pre-cache single file.
 */
export function cleanupUpdates(versionCode: number): void {
  try {
    const legacy = new File(Paths.cache, 'update.apk');
    if (legacy.exists) legacy.delete();
    const dir = updatesDir();
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      const code = Number(entry.name.split('-')[0]);
      if (entry instanceof File && (entry.name.endsWith('.part') || !(code > versionCode))) entry.delete();
    }
  } catch (e) {
    console.warn('[update] cleanup failed', e);
  }
}

export const nativeInstallDeps: InstallDeps = {
  cachedApk(name) {
    const file = new File(updatesDir(), name);
    return file.exists ? downloadedApk(file) : null;
  },
  async downloadApk(url, name, onProgress, signal) {
    const dir = updatesDir();
    if (!dir.exists) dir.create({ intermediates: true });
    const target = new File(dir, name);
    if (target.exists) target.delete();
    if (downloadFile) {
      await downloadFile(url, target.uri, {
        threads: DOWNLOAD_THREADS,
        signal,
        onProgress: (bytes, total) => onProgress({ bytes, total: total > 0 ? total : null }),
      });
      return downloadedApk(new File(dir, name));
    }
    const file = await File.downloadFileAsync(url, target, {
      idempotent: true,
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => onProgress({ bytes: bytesWritten, total: totalBytes > 0 ? totalBytes : null }),
    });
    return downloadedApk(file);
  },
  async launchInstaller(contentUri) {
    await startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: APK_MIME,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  },
  async openURL(url) {
    await Linking.openURL(url);
  },
};
