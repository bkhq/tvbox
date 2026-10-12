// @ts-check
// Plain CommonJS: the Expo config loader transpiles app.config.ts itself but
// not the local modules it requires.
const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins');

const BEGIN = '// @generated begin tvbox-abi-flavors';
const END = '// @generated end tvbox-abi-flavors';
const FLAVORS = [
  { name: 'arm64_v8a', abi: 'arm64-v8a' },
  { name: 'armeabi_v7a', abi: 'armeabi-v7a' },
];

const flavorBlock = FLAVORS.map(
  ({ name, abi }) => `        ${name} {
            dimension "abi"
            ndk { abiFilters "${abi}" }
            // Read at runtime to pick the update channel; universal builds have no such resource.
            resValue "string", "tvbox_abi_flavor", "${name}"
        }`,
).join('\n');

const GRADLE = `${BEGIN}
// Release APKs per ABI, like the Java app (app/build.gradle).
android {
    flavorDimensions = ["abi"]
    productFlavors {
${flavorBlock}
    }
}

androidComponents {
    // Runs after the React Native plugin's finalizeDsl, which adds every
    // reactNativeArchitectures entry to defaultConfig.ndk.abiFilters; flavor
    // filters are merged with those, so drop them to keep one ABI per flavor.
    finalizeDsl { ext -> ext.defaultConfig.ndk.abiFilters.clear() }
    onVariants(selector().withBuildType('release')) { variant ->
        // The "leanback-" prefix names the update channel the worker serves.
        def abi = variant.productFlavors.collectEntries { [(it.first): it.second] }['abi'] ?: 'abi'
        variant.outputs.each { output ->
            output.outputFileName.set("leanback-\${abi}.apk")
        }
    }
}
${END}`;

/**
 * Splits the Android build into arm64_v8a / armeabi_v7a product flavors with
 * leanback-<flavor>.apk release outputs. app.config.ts applies it only when
 * ANDROID_ABI_FLAVORS=1, so default prebuilds stay universal.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withAndroidAbiFlavors = (config) => {
  config = withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('withAndroidAbiFlavors: app/build.gradle must be Groovy');
    }
    config.modResults.contents = addGeneratedBlock(config.modResults.contents);
    return config;
  });
  return withGradleProperties(config, (config) => {
    // Native code is only built for the flavor ABIs.
    const value = FLAVORS.map((flavor) => flavor.abi).join(',');
    const item = config.modResults.find(
      (entry) => entry.type === 'property' && entry.key === 'reactNativeArchitectures',
    );
    if (item && item.type === 'property') {
      item.value = value;
    } else {
      config.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value });
    }
    return config;
  });
};

/**
 * Appends the flavor block, replacing a previous copy so reruns are idempotent.
 *
 * @param {string} contents
 * @returns {string}
 */
function addGeneratedBlock(contents) {
  const start = contents.indexOf(BEGIN);
  if (start !== -1) {
    const end = contents.indexOf(END, start);
    if (end === -1) throw new Error('withAndroidAbiFlavors: unterminated generated block');
    contents = contents.slice(0, start) + contents.slice(end + END.length);
  }
  return `${contents.trimEnd()}\n\n${GRADLE}\n`;
}

module.exports = withAndroidAbiFlavors;
module.exports.addGeneratedBlock = addGeneratedBlock;
