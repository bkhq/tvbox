import type { ConfigContext, ExpoConfig } from 'expo/config';

import withAndroidLeanback from './plugins/withAndroidLeanback';

const APP_ID = 'cc.bkhq.tvbox';

// Same rule as src/core/workerUrl.ts; the config loader cannot require local TS modules.
const workerUrl = (process.env.WORKER_URL ?? '').trim().replace(/\/+$/, '');

// Release builds set these from the rn-vX.Y.Z tag; local builds keep the defaults.
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

export default ({ config }: ConfigContext): ExpoConfig =>
  withAndroidLeanback({
    ...config,
    name: '影视',
    slug: 'tvbox',
    scheme: 'tvbox',
    version: versionName,
    orientation: 'default',
    ios: {
      bundleIdentifier: APP_ID,
      buildNumber: String(versionCode),
    },
    android: {
      package: APP_ID,
      versionCode,
      permissions: ['android.permission.REQUEST_INSTALL_PACKAGES'],
    },
    plugins: [
      [
        'expo-build-properties',
        {
          // modules/mpv ships the newer libc++_shared.so libmpv was built against; React Native
          // ships one too.
          android: { packagingOptions: { pickFirst: ['**/libc++_shared.so'] } },
        },
      ],
      // Switches prebuild output to Android TV / tvOS when EXPO_TV=1.
      '@react-native-tvos/config-tv',
      // Media3 HLS / DASH / SmoothStreaming are on by default; UIBackgroundModes audio for the background setting.
      ['react-native-video', { enableBackgroundAudio: true }],
    ],
    extra: {
      workerUrl,
    },
  });
