// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['android/**', 'ios/**', '.expo/**', '.tmp/**', 'coverage/**', 'dist/**', 'modules/quickjs/assets/**', 'modules/*/android/build/**', 'modules/*/android/.cxx/**', 'modules/*/ios/build/**'],
  },
]);
