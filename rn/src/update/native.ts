import { File, Paths } from 'expo-file-system';
import { startActivityAsync } from 'expo-intent-launcher';
import { Linking } from 'react-native';

import type { InstallDeps } from './install';

const APK_MIME = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 0x1;

export const nativeInstallDeps: InstallDeps = {
  async downloadApk(url, onProgress, signal) {
    const target = new File(Paths.cache, 'update.apk');
    if (target.exists) target.delete();
    const file = await File.downloadFileAsync(url, target, {
      idempotent: true,
      signal,
      onProgress: ({ bytesWritten, totalBytes }) => onProgress(totalBytes > 0 ? bytesWritten / totalBytes : null),
    });
    return {
      size: file.size,
      contentUri: file.contentUri,
      discard: () => {
        if (file.exists) file.delete();
      },
    };
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
