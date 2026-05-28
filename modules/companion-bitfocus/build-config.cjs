// Picked up automatically by @companion-module/tools' webpack config.
// We use it to silence webpack warnings for `ws`'s two optional native
// addons (`bufferutil` and `utf-8-validate`). They speed up WebSocket
// framing if present, but ws falls back to pure JS when they're missing —
// which is the case for us. IgnorePlugin makes webpack treat the imports
// as empty modules so they neither warn nor try to resolve at runtime.
const webpack = require('webpack');

module.exports = {
  plugins: [
    new webpack.IgnorePlugin({
      resourceRegExp: /^(bufferutil|utf-8-validate)$/,
    }),
  ],
};
