// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const globals = require('globals');

module.exports = defineConfig([
  expoConfig,
  {
    // Node scripts, tests and config plugins
    files: ['scripts/**/*.js', 'tests/**/*.js', 'plugins/**/*.js', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    ignores: ['dist/*', 'android/*', 'ios/*', 'builds/*'],
  },
]);
