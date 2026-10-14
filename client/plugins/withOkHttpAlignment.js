// @ts-check
// Plain CommonJS: the Expo config loader transpiles app.config.ts itself but
// not the local modules it requires.
const { withAppBuildGradle } = require('expo/config-plugins');

const BEGIN = '// @generated begin tvbox-okhttp-alignment';
const END = '// @generated end tvbox-okhttp-alignment';
// Must match the okhttp modules/jarspider exposes as `api`.
const OKHTTP_VERSION = '5.4.0';

const GRADLE = `${BEGIN}
// modules/jarspider puts okhttp ${OKHTTP_VERSION} on the classpath (spider jars need 5.x), but React Native
// still asks for okhttp-urlconnection 4.x, whose JavaNetCookieJar calls okhttp3.internal.Util (gone in
// 5.x) and crashes the OkHttp dispatcher. Lift every 3.x/4.x okhttp3 module the app packages to
// ${OKHTTP_VERSION}; there okhttp-urlconnection keeps okhttp3.JavaNetCookieJar on top of
// okhttp-java-net-cookiejar. App configurations only: libraries such as react-native-video still
// compile against okhttp 4.x internals.
configurations.configureEach {
    resolutionStrategy.eachDependency { details ->
        if (details.requested.group == 'com.squareup.okhttp3' && details.requested.version?.matches('[34]\\\\..*')) {
            details.useVersion '${OKHTTP_VERSION}'
            details.because 'single okhttp ${OKHTTP_VERSION} family (modules/jarspider)'
        }
    }
}
${END}`;

/**
 * Aligns every com.squareup.okhttp3 module in the generated Android project
 * on OKHTTP_VERSION via an app/build.gradle resolution rule.
 *
 * @type {import('expo/config-plugins').ConfigPlugin}
 */
const withOkHttpAlignment = (config) =>
  withAppBuildGradle(config, (config) => {
    if (config.modResults.language !== 'groovy') {
      throw new Error('withOkHttpAlignment: app/build.gradle must be Groovy');
    }
    config.modResults.contents = addGeneratedBlock(config.modResults.contents);
    return config;
  });

/**
 * Appends the resolution block, replacing a previous copy so reruns are idempotent.
 *
 * @param {string} contents
 * @returns {string}
 */
function addGeneratedBlock(contents) {
  const start = contents.indexOf(BEGIN);
  if (start !== -1) {
    const end = contents.indexOf(END, start);
    if (end === -1) throw new Error('withOkHttpAlignment: unterminated generated block');
    contents = contents.slice(0, start) + contents.slice(end + END.length);
  }
  return `${contents.trimEnd()}\n\n${GRADLE}\n`;
}

module.exports = withOkHttpAlignment;
module.exports.addGeneratedBlock = addGeneratedBlock;
module.exports.OKHTTP_VERSION = OKHTTP_VERSION;
