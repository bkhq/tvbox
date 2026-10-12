// @ts-check
const { withAppBuildGradle, withProjectBuildGradle } = require('expo/config-plugins');

const MARKER = '// jarspider module: desugaring + jitpack';

// The bundled catvod library needs core library desugaring in the app.
const APP_BLOCK = `
${MARKER}
android {
    compileOptions {
        coreLibraryDesugaringEnabled true
    }
}
dependencies {
    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.1.5'
}
`;

// sardine-android is only published on JitPack.
const PROJECT_BLOCK = `
${MARKER}
allprojects {
    repositories {
        maven { url 'https://www.jitpack.io' }
    }
}
`;

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withJarSpider = (config) => {
  config = withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(MARKER)) {
      config.modResults.contents += APP_BLOCK;
    }
    return config;
  });
  return withProjectBuildGradle(config, (config) => {
    const { contents } = config.modResults;
    if (!contents.includes(MARKER) && !contents.includes('jitpack.io')) {
      config.modResults.contents += PROJECT_BLOCK;
    }
    return config;
  });
};

module.exports = withJarSpider;
