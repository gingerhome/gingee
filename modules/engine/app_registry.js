/**
 * @module engine/app_registry
 * @description Discover and initialize apps under web_root.
 * Engine-internal — not for sandboxed app require.
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
  const appDirs = fs.readdirSync(webPath);

  for (const appName of appDirs) {
    const appPath = path.join(webPath, appName);
    if (fs.statSync(appPath).isDirectory()) {
      const appWebPath = path.join(webPath, appName);
      const appBoxPath = path.join(appPath, 'box');
      const appConfigPath = path.join(appPath, 'box', 'app.json');
      if (fs.existsSync(appConfigPath)) {
        // Create a dedicated logger for this app
        const dedicatedLogger = appLogger.createAppLogger(appName, appBoxPath, config.logging); //use server level logging config

        // Resolve env:/file: refs so jwt_secret, db passwords, api keys never need process in the sandbox.
        const userAppConfig = secrets.resolveDeep(require(appConfigPath));
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
          // Ensure nested objects are also safely merged
          env: { ...defaultAppConfig.env, ...(userAppConfig.env || {}) },
          cache: { ...defaultAppConfig.cache, ...(userAppConfig.cache || {}) },
          logging: { ...defaultAppConfig.logging, ...(userAppConfig.logging || {}) }
        };
        const isDevelopment = appConfig.mode === 'development';

        const app = { name: appName, config: appConfig, appWebPath, appBoxPath, logger: dedicatedLogger };

        const routesPath = path.join(appBoxPath, 'routes.json');
        if (fs.existsSync(routesPath)) {
          try {
            const routesConfig = require(routesPath);
            app.compiledRoutes = [];
            for (const route of routesConfig.routes) {
              // Compile the path into a regex and store it for fast matching.
              app.compiledRoutes.push({
                method: route.method ? route.method.toUpperCase() : 'GET',
                script: route.script,
                // The 'match' function from path-to-regexp is great for this
                matcher: match(route.path, { decode: decodeURIComponent })
              });
            }
            logger.info(`Initialized ${app.compiledRoutes.length} manifest routes for app '${appName}'.`);
          } catch (e) {
            logger.error(`Failed to parse or compile routes.json for app '${appName}': ${e.message}`);
          }
        }

        apps[appName] = app;

        if (appConfig.type === 'SPA' && isDevelopment) {
          await als.run({ logger }, () => gdev.startDevServer(app)); // Start the dev server using the gdev module
        }

        if (appConfig.db && Array.isArray(appConfig.db)) {
          appConfig.db.forEach((dbConfig) => {
            if (dbConfig.name && dbConfig.type) {
              const uniqueDbName = `${dbConfig.name}`;
              apps[appName].appBoxPath = path.join(webPath, appName, 'box');
              try {
                db.init(uniqueDbName, dbConfig, apps[appName], dedicatedLogger);
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
          email.initApp(apps[appName], dedicatedLogger);
        } catch (err) {
          logger.error(`Failed to initialize email for app '${appName}': ${err.message}`);
        }

        try {
          ai.initApp(apps[appName], dedicatedLogger);
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

        // Register CRON schedules after permissions are loaded (no-op if scheduler disabled).
        try {
          await scheduler.registerApp(apps[appName]);
        } catch (err) {
          logger.error(`Failed to register schedules for app '${appName}': ${err.message}`);
        }
      }
    }
  }

  return apps;
}

module.exports = {
  initializeApps
};
