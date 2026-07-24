/**
 * @module engine/boot
 * @description Full server startup sequence (services, apps, HTTP).
 * Engine-internal — not for sandboxed app require.
 */

const fs = require('fs');
const { als } = require('../gingee.js');
const email = require('../email.js');
const ai = require('../ai.js');
const scheduler = require('../scheduler.js');
const limits = require('../limits.js');
const egress = require('../egress.js');
const metrics = require('../metrics.js');
const audit = require('../audit.js');
const appLogger = require('../logger.js');
const cache = require('../cache_service.js');
const pdf = require('../pdf.js');
const gdev = require('../gdev.js');
const packageJson = require('../../package.json');
const { ensureProjectDirs } = require('./paths.js');
const { createServerLogger } = require('./logger_setup.js');
const { startHttpServers } = require('./http_servers.js');
const { initializeApps } = require('./app_registry.js');
const workerManager = require('./isolation/worker_manager.js');
const websocketHub = require('./websocket_hub.js');

/**
 * Boot the Gingee control plane and start listening.
 * @param {object} options
 * @param {object} options.config
 * @param {string} options.webPath
 * @param {string} options.projectRoot
 * @param {string} options.engineRoot
 * @param {function} options.requestHandler - (req, res, apps, config, logger) => ...
 * @returns {Promise<{ apps: object, logger: object }>}
 */
async function startServer(options) {
  const { config, webPath, projectRoot, requestHandler } = options;

  ensureProjectDirs(projectRoot);

  const logger = createServerLogger(config, projectRoot);

  // Initialize the app logger factory with the main server logger instance.
  appLogger.init(logger);

  // Initialize the cache service as configured, else fall back to in-memory cache
  await cache.init(config.cache, logger);

  // Server-level email defaults (optional); per-app email is initialized in initializeApps
  email.initServer(config.email, logger);

  // Server-level AI defaults (optional); per-app AI is initialized in initializeApps
  ai.initServer(config.ai, logger);

  // Scheduler (default disabled). Apps' app.json schedules register during initializeApps.
  scheduler.initServer(config.scheduler, logger, config);

  // Request/outbound timeouts and concurrency limits
  limits.initServer(config.limits, logger);

  // Outbound URL / SSRF policy for httpclient + scheduler URL jobs
  egress.initServer(config.egress, logger);

  // Prometheus metrics (engine /metrics; default localhost-only)
  metrics.initServer(config.metrics, logger, packageJson.version || 'unknown');

  // JSONL audit trail for permissions + lifecycle
  audit.initServer(config.audit, projectRoot, logger);

  // WebSockets (master upgrade; apps register after load)
  websocketHub.initServer(config.websockets, logger, config);

  const pdfStatus = pdf.init(); // Initialize the PDF module
  if (pdfStatus.error) {
    logger.error(`Failed to initialize PDF module: ${pdfStatus.error.message}`);
  }

  if (!fs.existsSync(webPath)) {
    console.error(`FATAL: The configured web directory does not exist at: ${webPath}`);
    console.error("Please create the directory or correct the 'web' path in your gingee.json file.");
    process.exit(1);
  }
  logger.info(`Serving from Web root folder: ${webPath}`);

  // Process isolation (opt-in): init manager before apps so workers can start at register time.
  workerManager.init(config, logger, webPath);
  if (config.isolation && config.isolation.mode === 'process') {
    logger.info(
      `[isolation] mode=process default=${config.isolation.default || 'inprocess'}`
    );
  }

  const apps = await initializeApps(config, logger, webPath);
  workerManager.setAppsRegistry(apps);
  websocketHub.setAppsRegistry(apps);

  // Bind WebSocket handlers (permission + app.json websockets required)
  for (const appName of Object.keys(apps)) {
    try {
      await websocketHub.registerApp(apps[appName], config);
    } catch (err) {
      logger.error(`[websockets] register '${appName}' failed: ${err.message}`);
    }
  }

  const reqHandler = (req, res) => requestHandler(req, res, apps, config, logger);
  startHttpServers({
    config,
    logger,
    projectRoot,
    reqHandler,
    onServer: (server) => websocketHub.attachServer(server)
  });

  const shutdown = () => {
    try {
      websocketHub.shutdownAll();
    } catch (_) {
      /* ignore */
    }
    try {
      workerManager.shutdownAll();
    } catch (_) {
      /* ignore */
    }
    als.run({ logger }, () => {
      for (const appName in apps) {
        gdev.stopDevServer(apps[appName]);
      }
    });
  };

  process.on('exit', shutdown);
  process.on('SIGINT', () => process.exit());
  process.on('SIGTERM', () => process.exit());

  return { apps, logger };
}

module.exports = {
  startServer,
  initializeApps
};
