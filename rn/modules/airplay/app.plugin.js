// @ts-check
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// airplay module: desugaring + packaging';

// The vendored AirPlay library uses java.time (API 26+): the app must enable
// core library desugaring, and Netty jars ship duplicate META-INF files.
const BLOCK = `
${MARKER}
android {
    compileOptions {
        coreLibraryDesugaringEnabled true
    }
    packaging {
        resources {
            excludes += ['META-INF/INDEX.LIST', 'META-INF/io.netty.versions.properties']
        }
    }
}
dependencies {
    coreLibraryDesugaring 'com.android.tools:desugar_jdk_libs_nio:2.1.5'
}
`;

/** @type {import('expo/config-plugins').ConfigPlugin} */
const withAirPlay = (config) =>
  withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes(MARKER)) {
      config.modResults.contents += BLOCK;
    }
    return config;
  });

module.exports = withAirPlay;
