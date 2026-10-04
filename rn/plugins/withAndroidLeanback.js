// @ts-check
// Plain CommonJS: the Expo config loader transpiles app.config.ts itself but
// not the local modules it requires.
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const LEANBACK_LAUNCHER = 'android.intent.category.LEANBACK_LAUNCHER';
const OPTIONAL_FEATURES = [
  'android.software.leanback',
  'android.hardware.touchscreen',
  'android.hardware.faketouch',
];

/**
 * Makes the single phone build also launchable on Android TV: adds the
 * LEANBACK_LAUNCHER category to the main activity and declares leanback and
 * touchscreen as optional features. config-tv only does this when EXPO_TV=1;
 * the checks here are idempotent so both can run together.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withAndroidLeanback = (config) =>
  withAndroidManifest(config, (config) => {
    const manifest = config.modResults;
    const activity = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    const launchFilter = activity['intent-filter']?.find((filter) =>
      filter.action?.some((action) => action.$['android:name'] === 'android.intent.action.MAIN'),
    );
    if (!launchFilter) {
      throw new Error('withAndroidLeanback: main activity has no MAIN intent filter');
    }
    const categories = (launchFilter.category ??= []);
    if (!categories.some((category) => category.$['android:name'] === LEANBACK_LAUNCHER)) {
      categories.push({ $: { 'android:name': LEANBACK_LAUNCHER } });
    }

    const features = (manifest.manifest['uses-feature'] ??= []);
    for (const name of OPTIONAL_FEATURES) {
      const existing = features.find((feature) => feature.$['android:name'] === name);
      if (existing) {
        existing.$['android:required'] = 'false';
      } else {
        features.push({ $: { 'android:name': name, 'android:required': 'false' } });
      }
    }
    return config;
  });

module.exports = withAndroidLeanback;
