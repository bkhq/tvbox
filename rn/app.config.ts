import type { ConfigContext, ExpoConfig } from 'expo/config';

import withAndroidLeanback from './plugins/withAndroidLeanback';

const APP_ID = 'cc.bkhq.tvbox';

// Same rule as src/core/workerUrl.ts; the config loader cannot require local TS modules.
const workerUrl = (process.env.WORKER_URL ?? '').trim().replace(/\/+$/, '');

export default ({ config }: ConfigContext): ExpoConfig =>
  withAndroidLeanback({
    ...config,
    name: '影视',
    slug: 'tvbox',
    scheme: 'tvbox',
    version: '1.0.0',
    orientation: 'default',
    ios: {
      bundleIdentifier: APP_ID,
      buildNumber: '1',
    },
    android: {
      package: APP_ID,
      versionCode: 1,
    },
    plugins: [
      'expo-build-properties',
      // Switches prebuild output to Android TV / tvOS when EXPO_TV=1.
      '@react-native-tvos/config-tv',
    ],
    extra: {
      workerUrl,
    },
  });
