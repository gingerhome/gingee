/**
 * Gingee process entry point.
 *
 * Loads config, composes engine modules, exports test hooks, and boots the server.
 * Behavior matches the pre-refactor monolithic gingee.js (no intentional breaking changes).
 *
 * Implementation lives under modules/engine/* (engine-internal; not for app require).
 */

const path = require('path');

const engineRoot = path.resolve(__dirname);
const projectRoot = process.cwd();

// Add the 'modules' folder to the Node.js search path (must run before other local requires that rely on it)
require('app-module-path').addPath(path.join(engineRoot, 'modules'));

const { loadConfig } = require('./modules/engine/config.js');
const { initializeApps } = require('./modules/engine/app_registry.js');
const { createRequestHandler } = require('./modules/engine/request_handler.js');
const { startServer } = require('./modules/engine/boot.js');

const { config, webPath } = loadConfig({ root: projectRoot });

const requestHandler = createRequestHandler({
  webPath,
  engineRoot
});

// Public exports for tests (same surface as before)
module.exports = { initializeApps, requestHandler };

// Startup — still runs on require('gingee') / node gingee.js (same as legacy IIFE)
startServer({
  config,
  webPath,
  projectRoot,
  engineRoot,
  requestHandler
}).catch((err) => {
  console.error('\nFATAL: An unhandled error occurred during Gingee startup.');
  console.error(err.stack || err.message);
  process.exit(1);
});
