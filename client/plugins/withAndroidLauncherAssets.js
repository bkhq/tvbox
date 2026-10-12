// @ts-check
// Plain CommonJS: the Expo config loader transpiles app.config.ts itself but
// not the local modules it requires.
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const DENSITIES = ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'];
const BANNER = '@mipmap/ic_banner';
// Same attributes as the Java app's <application>.
const APPLICATION_ATTRIBUTES = {
  'android:icon': '@mipmap/ic_launcher',
  'android:roundIcon': '@mipmap/ic_launcher_round',
  'android:banner': BANNER,
};

/**
 * @param {AndroidConfig.Manifest.AndroidManifest} manifest
 * @returns {AndroidConfig.Manifest.AndroidManifest}
 */
function setLauncherManifest(manifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
  Object.assign(application.$, APPLICATION_ATTRIBUTES);
  // The activity would inherit it; set explicitly so the leanback launcher entry names it.
  AndroidConfig.Manifest.getMainActivityOrThrow(manifest).$['android:banner'] = BANNER;
  return manifest;
}

/**
 * Copies the launcher assets into an Android res directory. The prebuild
 * template ships mipmap-<density>/ic_launcher.webp, which would clash with the
 * copied ic_launcher.png, so those are removed first.
 *
 * @param {string} assetsDir
 * @param {string} resDir
 */
function copyLauncherResources(assetsDir, resDir) {
  for (const density of DENSITIES) {
    fs.rmSync(path.join(resDir, `mipmap-${density}`, 'ic_launcher.webp'), { force: true });
  }
  fs.cpSync(assetsDir, resDir, { recursive: true });
}

/**
 * Uses the Java app's launcher icon, round icon and Android TV banner
 * (assets/android-res, copied from app/src/main/res). Expo's own icon
 * generation stays off because app.config.ts sets no `icon`/`adaptiveIcon`.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withAndroidLauncherAssets = (config) => {
  config = withAndroidManifest(config, (config) => {
    config.modResults = setLauncherManifest(config.modResults);
    return config;
  });
  return withDangerousMod(config, [
    'android',
    (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      copyLauncherResources(
        path.join(projectRoot, 'assets', 'android-res'),
        path.join(platformProjectRoot, 'app', 'src', 'main', 'res'),
      );
      return config;
    },
  ]);
};

module.exports = withAndroidLauncherAssets;
module.exports.setLauncherManifest = setLauncherManifest;
module.exports.copyLauncherResources = copyLauncherResources;
