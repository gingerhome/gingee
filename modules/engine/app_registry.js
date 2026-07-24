/**
 * @module engine/app_registry
 * @description Discover and initialize apps under web_root.
 * Engine-internal — not for sandboxed app require.
 *
 * Per-app failures (invalid app.json, init errors) are logged and skipped so the
 * server can still start with remaining apps.
 */

const fs = require('fs');
const path = require('path');
const { match } = require('path-to-regexp');
const { als } = require('../gingee.js');
const { runStartupScripts, loadPermissionsForApp } = require('../gapp_start.js');
const db = require('../db.js');
const email = require('../email.js');
const ai = require('../ai.js');
const scheduler = require('../scheduler.js');
const secrets = require('../secrets.js');
const appLogger = require('../logger.js');
const gdev = require('../gdev.js');
const { projectRoot } = require('./paths.js');
const workerManager = require('./isolation/worker_manager.js');
const { loadJsonFile } = require('../internal_utils.js');

/**
 * Initialize a single app directory. Throws on fatal config errors for that app.
 * @private
 */
async function initializeOneApp(appName, webPath, config, logger) {
  const appWebPath = path.join(webPath, appName);
  const appBoxPath = path.join(webPath, appName, 'box');
  const appConfigPath = path.join(appBoxPath, 'app.json');

  if (!fs.existsSync(appConfigPath)) {
    return null;
  }

  // Create a dedicated logger for this app (fall back to server logger if factory not ready)
  let dedicatedLogger = logger;
  try {
    dedicatedLogger = appLogger.createAppLogger(appName, appBoxPath, config.logging);
  } catch (logErr) {
    logger.warn(
      `App logger unavailable for '${appName}' (${logErr.message}); using server logger.`
    );
    dedicatedLogger = logger;
  }

  // Resolve env:/file: refs so jwt_secret, db passwords, api keys never need process in the sandbox.
  const userAppConfig = secrets.resolveDeep(loadJsonFile(appConfigPath));
  if (!userAppConfig || typeof userAppConfig !== 'object' || Array.isArray(userAppConfig)) {
    throw new Error(`app.json must be a JSON object`);
  }

  const defaultAppConfig = {
    name: 'Untitled Gingee App',
    description: '',
    version: '1.0.0',
    type: 'MPA',
    db: [],
    default_include: [],
    env: {},
    jwt_secret: null,
    cache: {
      client: { enabled: false, no_cache_regex: [] },
      server: { enabled: false, no_cache_regex: [] }
    },
    logging: {
      level: 'error'
    },
    in_maintenance: false,
    mode: 'production'
  };

  const appConfig = {
    ...defaultAppConfig,
    ...userAppConfig,
    env: { ...defaultAppConfig.env, ...(userAppConfig.env || {}) },
    cache: { ...defaultAppConfig.cache, ...(userAppConfig.cache || {}) },
    logging: { ...defaultAppConfig.logging, ...(userAppConfig.logging || {}) }
  };
  const isDevelopment = appConfig.mode === 'development';

  const app = { name: appName, config: appConfig, appWebPath, appBoxPath, logger: dedicatedLogger };

  const routesPath = path.join(appBoxPath, 'routes.json');
  if (fs.existsSync(routesPath)) {
    try {
      const routesConfig = loadJsonFile(routesPath);
      app.compiledRoutes = [];
      if (routesConfig && Array.isArray(routesConfig.routes)) {
        for (const route of routesConfig.routes) {
          app.compiledRoutes.push({
            method: route.method ? route.method.toUpperCase() : 'GET',
            script: route.script,
            matcher: match(route.path, { decode: decodeURIComponent })
          });
        }
        logger.info(`Initialized ${app.compiledRoutes.length} manifest routes for app '${appName}'.`);
      }
    } catch (e) {
      logger.error(`Failed to parse or compile routes.json for app '${appName}': ${e.message}`);
    }
  }

  if (appConfig.type === 'SPA' && isDevelopment) {
    await als.run({ logger }, () => gdev.startDevServer(app));
  }

  if (appConfig.db && Array.isArray(appConfig.db)) {
    appConfig.db.forEach((dbConfig) => {
      if (dbConfig.name && dbConfig.type) {
        const uniqueDbName = `${dbConfig.name}`;
        app.appBoxPath = path.join(webPath, appName, 'box');
        try {
          db.init(uniqueDbName, dbConfig, app, dedicatedLogger);
          logger.info(
            `Initialized database '${uniqueDbName}' for app '${appName}' with type '${dbConfig.type}'`
          );
        } catch (err) {
          logger.error(
            `Failed to initialize database '${uniqueDbName}' for app '${appName}': ${err.message}`
          );
        }
      }
    });
  }

  try {
    email.initApp(app, dedicatedLogger);
  } catch (err) {
    logger.error(`Failed to initialize email for app '${appName}': ${err.message}`);
  }

  try {
    ai.initApp(app, dedicatedLogger);
  } catch (err) {
    logger.error(`Failed to initialize AI for app '${appName}': ${err.message}`);
  }

  await als.run({ app, logger, projectRoot }, async () => {
    await loadPermissionsForApp(app);
  });

  if (appConfig.startup_scripts) {
    await als.run({ app, logger, globalConfig: config }, async () => {
      await runStartupScripts(app);
    });
  }

  try {
    await scheduler.registerApp(app);
  } catch (err) {
    logger.error(`Failed to register schedules for app '${appName}': ${err.message}`);
  }

  return app;
}

/**
 * Scan webPath for apps with box/app.json and initialize each.
 * Signature unchanged from legacy root gingee.js export.
 *
 * @param {object} config - resolved server config
 * @param {object} logger - winston-style logger
 * @param {string} webPath - absolute web root
 * @returns {Promise<object>} apps map
 */
async function initializeApps(config, logger, webPath) {
  const apps = {};
  let appDirs;
  try {
    appDirs = fs.readdirSync(webPath);
  } catch (err) {
    logger.error(`Cannot read web root '${webPath}': ${err.message}`);
    return apps;
  }

  for (const appName of appDirs) {
    const appPath = path.join(webPath, appName);
    let isDir = false;
    try {
      isDir = fs.statSync(appPath).isDirectory();
    } catch (_) {
      continue;
    }
    if (!isDir) continue;

    const appConfigPath = path.join(appPath, 'box', 'app.json');
    if (!fs.existsSync(appConfigPath)) continue;

    try {
      const app = await initializeOneApp(appName, webPath, config, logger);
      if (app) {
        apps[appName] = app;
      }
    } catch (err) {
      // Invalid JSON, secret resolve failure, unexpected init error — skip this app only.
      const detail = err && err.message ? err.message : String(err);
      logger.error(
        `Skipping app '${appName}': failed to load or initialize (${detail}). Fix box/app.json (or related config) and reload.`
      );
      try {
        console.error(
          `[gingee] Skipping app '${appName}': ${detail}`
        );
      } catch (_) {
        /* ignore */
      }
    }
  }

  const loaded = Object.keys(apps);
  logger.info(
    `App registry: ${loaded.length} app(s) loaded${loaded.length ? ` (${loaded.join(', ')})` : ''}.`
  );

  // Process isolation: start workers after full registry is known (supports isolation groups).
  workerManager.setAppsRegistry(apps);
  const startedKeys = new Set();
  for (const appName of loaded) {
    const app = apps[appName];
    try {
      if (workerManager.shouldIsolate(app, config)) {
        // startWorker is keyed by group/app; skip duplicates for group members
        const before = workerManager.getWorkerStats().map((s) => s.workerKey);
        await workerManager.startWorker(app, config);
        for (const s of workerManager.getWorkerStats()) {
          if (!before.includes(s.workerKey)) startedKeys.add(s.workerKey);
        }
      }
    } catch (err) {
      logger.error(
        `Failed to start isolation worker for app '${appName}': ${err.message}`
      );
    }
  }
  if (startedKeys.size) {
    logger.info(`[isolation] Started ${startedKeys.size} worker(s): ${[...startedKeys].join(', ')}`);
  }

  return apps;
}

module.exports = {
  initializeApps,
  // Test helpers (not part of public API)
  _initializeOneApp: initializeOneApp,
  _loadJsonFile: loadJsonFile
};
