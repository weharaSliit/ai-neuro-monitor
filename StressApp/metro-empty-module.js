// Stub for Node core modules that some web-only library code paths
// `require()` but never actually execute in a React Native/browser
// bundle (e.g. canvaskit-wasm's Node-targeted branch inside
// @shopify/react-native-skia's web loader, guarded by a
// `typeof process.versions.node` check that's false here). Metro still
// needs those requires to resolve successfully at bundle time even
// though the guarded code never runs -- see metro.config.js.
module.exports = {};
