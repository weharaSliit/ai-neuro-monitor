const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Preserved from the previous plain-object config (see git history for why
// these two were originally added) -- now layered onto Expo's actual
// defaults instead of replacing them entirely, which is what EAS Build's
// "custom metro.config.js that does not extend @expo/metro-config" warning
// was flagging (a real risk of missing assets in the production bundle,
// not a false alarm).
config.resolver.unstable_enablePackageExports = false;
config.resolver.useWatchman = false;

module.exports = config;
