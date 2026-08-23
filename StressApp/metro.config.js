module.exports = {
  resolver: {
    unstable_enablePackageExports: false,
    useWatchman: false,
    // canvaskit-wasm (pulled in by @shopify/react-native-skia's web
    // loader, used by FusionSessionScreen) requires "fs"/"path" inside a
    // dead code branch that's never actually reached in a React Native
    // bundle -- Metro still needs it to *resolve*, so point it at a
    // harmless stub instead of failing the whole bundle.
    extraNodeModules: {
      fs:   require.resolve('./metro-empty-module.js'),
      path: require.resolve('./metro-empty-module.js'),
    },
  },
};
