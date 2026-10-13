import type { ConfigContext, ExpoConfig } from 'expo/config';

import withAndroidAbiFlavors from './plugins/withAndroidAbiFlavors';
import withAndroidLeanback from './plugins/withAndroidLeanback';

const APP_ID = 'io.bk.tv';
// Third-party spider jars kill the process when the package is not on their whitelist.
const ANDROID_PACKAGE = 'com.fongmi.android.tv';

// Release builds set ANDROID_ABI_FLAVORS=1 for per-ABI APKs; the default stays universal.
const abiFlavors = (process.env.ANDROID_ABI_FLAVORS ?? '').trim() === '1';

// Same rule as src/core/workerUrl.ts; the config loader cannot require local TS modules.
const workerUrl = (process.env.WORKER_URL ?? '').trim().replace(/\/+$/, '');

// Release builds set these from the vX.Y.Z tag (plugins/version.js); local builds keep the defaults.
const versionName = (process.env.VERSION_NAME ?? '').trim() || '1.0.0';
const versionCode = parseVersionCode(process.env.VERSION_CODE);

function parseVersionCode(raw: string | undefined): number {
  const value = (raw ?? '').trim();
  if (!value) return 1;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`VERSION_CODE must be a positive integer, got "${raw}"`);
  }
  return Number(value);
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const appConfig = withAndroidLeanback({
    ...config,
    // Third-party spider jars (xiaosa) kill the process when the launcher label is not 影视; the in-app brand is 星幕.
    name: '影视',
    slug: 'tvbox',
    scheme: 'tvbox',
    version: versionName,
    orientation: 'default',
    ios: {
      bundleIdentifier: APP_ID,
      // iOS only: Android uses assets/android-res (plugins/withAndroidLauncherAssets.js).
      icon: './assets/icon.png',
      buildNumber: String(versionCode),
      // TVBox configs, CMS APIs and streams are commonly plain http.
      infoPlist: { NSAppTransportSecurity: { NSAllowsArbitraryLoads: true } },
    },
    android: {
      package: ANDROID_PACKAGE,
      versionCode,
      // POST_NOTIFICATIONS: the DLNA foreground service shows a notification.
      permissions: ['android.permission.REQUEST_INSTALL_PACKAGES', 'android.permission.POST_NOTIFICATIONS'],
      // Prebuild template defaults nothing in the app uses. LAN / multicast / foreground
      // service permissions come from the airplay, dlna and httpd module manifests.
      blockedPermissions: [
        'android.permission.READ_EXTERNAL_STORAGE',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        'android.permission.SYSTEM_ALERT_WINDOW',
        'android.permission.VIBRATE',
      ],
    },
    plugins: [
      [
        'expo-build-properties',
        {
          // modules/mpv ships the newer libc++_shared.so libmpv was built against; React Native
          // ships one too.
          android: {
            packagingOptions: { pickFirst: ['**/libc++_shared.so'] },
            // Same reason as NSAllowsArbitraryLoads: sources are commonly plain http.
            usesCleartextTraffic: true,
            // Extract .so files on install: SoLoader otherwise looks inside the APK under the first
            // ABI the device reports, which need not be the installed one, and crashes on launch.
            useLegacyPackaging: true,
          },
        },
      ],
      // Switches prebuild output to Android TV / tvOS when EXPO_TV=1.
      '@react-native-tvos/config-tv',
      // Media3 HLS / DASH / SmoothStreaming are on by default; UIBackgroundModes audio for the background setting.
      ['react-native-video', { enableBackgroundAudio: true }],
      // Launcher icon and Android TV banner; no top-level expo `icon`, so nothing overwrites them.
      './plugins/withAndroidLauncherAssets.js',
      // Android-only AirPlay receiver: app-level desugaring and Netty packaging excludes.
      './modules/airplay/app.plugin.js',
      // Android-only JAR spiders: app-level desugaring and the JitPack repository.
      './modules/jarspider/app.plugin.js',
      // Local network usage text and Bonjour service for the httpd module (iOS/tvOS).
      './modules/httpd/app.plugin.js',
      // Outfit for Latin text and digits, embedded at build time; family names are the file names.
      [
        'expo-font',
        {
          fonts: [
            './assets/fonts/Outfit-Medium.ttf',
            './assets/fonts/Outfit-SemiBold.ttf',
            './assets/fonts/Outfit-Bold.ttf',
          ],
        },
      ],
    ],
    extra: {
      workerUrl,
    },
  });
  return abiFlavors ? withAndroidAbiFlavors(appConfig) : appConfig;
};
