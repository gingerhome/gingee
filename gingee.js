const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const { Pool } = require('pg');
const zlib = require('zlib');
const { pathToRegexp, match } = require('path-to-regexp');

const winston = require('winston');
require('winston-daily-rotate-file');


const engineRoot = __dirname;
const projectRoot = process.cwd();

// Add the 'modules' folder to the Node.js search path
require('app-module-path').addPath(path.join(engineRoot, 'modules'));


const mimeTypes = require('mime-types');
const { createGRequire, runInGBox, transpileCache } = require('./modules/gbox.js');
const userConfig = require(path.join(projectRoot, 'gingee.json'));
const { als } = require('./modules/gingee.js');
const { runStartupScripts, loadPermissionsForApp } = require('./modules/gapp_start.js');
const db = require('./modules/db.js');
const { log } = require('console');
const appLogger = require('./modules/logger.js');
const cache = require('./modules/cache_service.js');
const pdf = require('./modules/pdf.js');

const defaultConfig = {
  server: {
    http: {
      enabled: true,
      port: 7070
    },
    https: {
      enabled: false,
      port: 7443,
      key_file: './settings/ssl/key.pem',
      cert_file: './settings/ssl/cert.pem'
    }
  },
  web_root: "./web",
  content_encoding: {
    enabled: true
  },
  max_body_size: "25mb",
  logging: {
    level: "error",
    rotation: {
      period_days: 7,
      max_size_mb: 50
    }
  },
  box: {
    allowed_modules: []
  },
  default_app: "glade", //set default app as the glade admin panel
  privileged_apps: ['glade'] //set glade as a priviledged app by default
};

// Merge the user's config over the defaults.
// This creates a final, safe config object. The user's values take precedence.
const config = {
  ...defaultConfig,
  ...userConfig,
  server: { ...defaultConfig.server, ...userConfig.server },
  logging: {
    ...defaultConfig.logging,
    ...userConfig.logging,
    rotation: { ...defaultConfig.logging.rotation, ...(userConfig.logging && userConfig.logging.rotation) }
  },
  box: { ...defaultConfig.box, ...userConfig.box }
};

let webPath;
const configWebPath = config.web_root || './web';
if (path.isAbsolute(configWebPath)) {
  // Use the absolute path directly.
  webPath = configWebPath;
} else {
  // Resolve the relative path from the project's root directory.
  webPath = path.resolve(projectRoot, configWebPath);
}

async function initializeApps(config, logger, webPath) {
  // --- App Initialization ---
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
        const dedicatedLogger = appLogger.createAppLogger(appName, appBoxPath, config.logging); //user server level logging config

        const userAppConfig = require(appConfigPath);
        const defaultAppConfig = {
          name: "Untitled Gingee App",
          description: "",
          version: "1.0.0",
          type: "MPA",
          db: [],
          "default_include": [],
          env: {},
          jwt_secret: null,
          cache: {
            client: { enabled: false, no_cache_regex: [] },
            server: { enabled: false, no_cache_regex: [] }
          },
          logging: {
            level: "error"
          },
          in_maintenance: false
        };

        const appConfig = {
          ...defaultAppConfig,
          ...userAppConfig,
          // Ensure nested objects are also safely merged
          env: { ...defaultAppConfig.env, ...(userAppConfig.env || {}) },
          cache: { ...defaultAppConfig.cache, ...(userAppConfig.cache || {}) },
          logging: { ...defaultAppConfig.logging, ...(userAppConfig.logging || {}) }
        };

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

        if (appConfig.db && Array.isArray(appConfig.db)) {
          appConfig.db.forEach(dbConfig => {
            if (dbConfig.name && dbConfig.type) {
              const uniqueDbName = `${dbConfig.name}`;
              apps[appName].appBoxPath = path.join(webPath, appName, 'box');
              try {
                db.init(uniqueDbName, dbConfig, apps[appName], dedicatedLogger);
                logger.info(`Initialized database '${uniqueDbName}' for app '${appName}' with type '${dbConfig.type}'`);
              } catch (err) {
                logger.error(`Failed to initialize database '${uniqueDbName}' for app '${appName}': ${err.message}`);
              }
            }
          });
        }

        await als.run({ app, logger, projectRoot }, async () => {
          await loadPermissionsForApp(app);
        });

        if (appConfig.startup_scripts) {
          await als.run({ app, logger, globalConfig: config }, async () => {
            await runStartupScripts(app);
          });
        }
      }
    }
  }

  return apps;
}

// --- Request Handler ---
async function requestHandler(req, res, apps, config, logger) {
  try {
    const urlPath = req.url.split('?')[0];
    const queryIndex = req.url.indexOf('?');
    const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';

    if (urlPath === '/') {
      const defaultApp = config.default_app;

      if (defaultApp && apps[defaultApp]) {
        // Reconstruct the URL, preserving any query string.
        req.url = `/${defaultApp}/${queryString}`; // Note the trailing slash
        logger.info(`Routing root request to default app '${defaultApp}'. New URL: ${req.url}`);
      }
    }

    const urlWithoutQuery = req.url.split('?')[0];
    const urlParts = urlWithoutQuery.split('/').filter(Boolean);
    const appName = urlParts[0];
    const app = apps[appName];

    if (app && app.in_maintenance) {
      logger.warn(`Request to '${req.url}' blocked because app '${appName}' is in maintenance mode.`);
      res.writeHead(503, { 'Content-Type': 'text/html' });
      res.end('<h1>503 Service Unavailable</h1><p>This application is currently undergoing maintenance. Please try again shortly.</p>');
      return;
    }

    const headers = {};
    let ctxWebPath = webPath; // Default to the global webPath
    let allApps = apps; // Default to the full apps object
    let appNames = Object.keys(apps); // Default to all app names
    let isPrivileged = false;

    if (config.privileged_apps && !config.privileged_apps.includes(appName)) {
      appNames = [appName];
      //ctxWebPath = null; // Reset webPath for non-privileged apps 
      allApps = { [appName]: app }; // Only include the current app
    }

    if (config.privileged_apps && config.privileged_apps.includes(appName)) {
      isPrivileged = true;
    }

    if (!app) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('APP_NOT_FOUND');
      return;
    }

    let routeParams = null;
    let targetScriptFolder = null;
    let targetScriptPath = null;
    const requestPath = urlWithoutQuery.substring(appName.length + 1); // Get path relative to the app

    if (app.compiledRoutes) {
      // Manifest-Based Routing
      for (const route of app.compiledRoutes) {
        if (req.method === route.method || route.method === 'ALL') {
          const matchResult = route.matcher(requestPath);
          if (matchResult) {
            targetScriptPath = path.join(app.appBoxPath, route.script);
            routeParams = matchResult.params;
            targetScriptFolder = path.dirname(targetScriptPath);
            break; // Stop on the first match
          }
        }
      }
    }

    // File-Based Routing, if no compiled routes or compiled routes did not match
    if (!targetScriptPath && !path.extname(requestPath)) {
      const potentialScriptPath = path.join(app.appBoxPath, ...urlParts.slice(1)) + '.js';
      if (fs.existsSync(potentialScriptPath)) {
        targetScriptPath = potentialScriptPath;
        targetScriptFolder = path.dirname(targetScriptPath);
      }
    }

    als.run({ globalConfig: config, req, res, projectRoot, webPath: ctxWebPath, appName, isPrivileged, app, allApps, appNames, logger: app.logger, routeParams, scriptPath: targetScriptPath, scriptFolder: targetScriptFolder, staticFileCache: cache, transpileCache, maxBodySize: config.max_body_size }, async () => {
      if (req.url.includes(`/${appName}/box`)) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('ACCESS_DENIED');
        return;
      }

      // Determine if compression should be used for this request
      const acceptEncoding = req.headers['accept-encoding'] || '';
      const canCompress = config.content_encoding.enabled && acceptEncoding.includes('gzip');

      const filePath = path.join(webPath, ...urlParts);

      const defaultCacheConfig = {
        client: { enabled: false, no_cache_regex: [] },
        server: { enabled: false, no_cache_regex: [] }
      };

      const cacheConfig = app.config.cache || defaultCacheConfig;
      // Ensure nested objects exist to prevent errors
      cacheConfig.client = cacheConfig.client || defaultCacheConfig.client;
      cacheConfig.server = cacheConfig.server || defaultCacheConfig.server;

      //if targetScriptPath then go to script execution
      if (!targetScriptPath && path.extname(filePath)) {
        const serverCacheConfig = cacheConfig.server;
        let useCache = serverCacheConfig.enabled;
        const cacheKey = `static:${filePath}`;

        let cacheEntry;
        if (useCache) {
          // Check if the path matches a no-cache rule
          const isNoCachePath = serverCacheConfig.no_cache_regex.some(r => new RegExp(r).test(req.url));
          if (isNoCachePath) {
            useCache = false;
            logger.info(`No-cache rule matched for path: ${req.url}`);
          } else {
            // Try to get the cached file content
            cacheEntry = await cache.get(cacheKey);
          }
        }

        if (useCache && cacheEntry) {
          headers['Content-Type'] = cacheEntry.contentType || mimeTypes.contentType(path.extname(filePath)) || 'application/octet-stream';
          logger.info(`[CACHE HIT] Serving static file: ${filePath}`);

          if (cacheConfig.client.enabled && !cacheConfig.client.no_cache_regex.some(r => new RegExp(r).test(req.url))) {
            headers['Cache-Control'] = 'public, max-age=31536000';
          }

          const content = Buffer.from(cacheEntry.content, 'base64');
          if (canCompress) {
            zlib.gzip(content, (err, compressedData) => {
              if (err) {
                // If compression fails, send uncompressed
                res.writeHead(200, headers);
                res.end(content);
              } else {
                headers['Content-Encoding'] = 'gzip';
                res.writeHead(200, headers);
                res.end(compressedData);
              }
            });
          } else {
            // Send uncompressed
            res.writeHead(200, headers);
            res.end(content);
          }
          return;
        }

        // Static file
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('FILE_NOT_FOUND');
          } else {
            const ext = path.extname(filePath);
            const contentType = mimeTypes.contentType(ext) || 'application/octet-stream';
            const headers = { 'Content-Type': contentType };

            if (useCache) {
              cache.set(cacheKey, { contentType, content: data.toString('base64') });
              logger.info(`[CACHE SET] Caching static file: ${filePath}`);
            }

            if (cacheConfig.client.enabled && !cacheConfig.client.no_cache_regex.some(r => new RegExp(r).test(req.url))) {
              headers['Cache-Control'] = 'public, max-age=31536000';
            } else {
              headers['Cache-Control'] = 'no-store';
            }

            if (canCompress) {
              zlib.gzip(data, (err, compressedData) => {
                if (err) {
                  // If compression fails, send uncompressed
                  res.writeHead(200, headers);
                  res.end(data);
                } else {
                  headers['Content-Encoding'] = 'gzip';
                  res.writeHead(200, headers);
                  res.end(compressedData);
                }
              });
            } else {
              // Send uncompressed
              res.writeHead(200, headers);
              res.end(data);
            }
          }
        });
      } else {
        // Server script or directory
        const scriptPath = targetScriptPath;
        if (fs.existsSync(scriptPath)) {
          logger.info(`Executing script: ${scriptPath}`);
          try {
            // --- Server Script Cache Logic ---
            const serverCacheConfig = cacheConfig.server;
            let useCache = serverCacheConfig.enabled;

            if (useCache) {
              // Check if the path matches a no-cache rule
              const isNoCachePath = serverCacheConfig.no_cache_regex.some(r => new RegExp(r).test(req.url));
              if (isNoCachePath) {
                useCache = false;
              }
            }

            if (!useCache) {
              // If caching is disabled for this script, remove it from Node's require cache
              // to force a reload from the file.
              delete require.cache[require.resolve(scriptPath)];
              logger.info(`Reloading script (cache disabled): ${scriptPath}`);
            }
            // --- End Cache Logic ---

            const appBoxPath = path.join(webPath, appName, 'box');
            const globalModulesPath = path.join(engineRoot, 'modules');
            const allowedBuiltinModules = (config.box && config.box.allowed_modules) || [];
            const privilegedApps = config.privileged_apps || [];

            const gBoxConfig = {
              appName,
              app,
              appBoxPath,
              globalModulesPath,
              allowedBuiltinModules,
              privilegedApps,
              useCache,
              logger
            };

            if (app.config.default_include) {
              // Note: default_include scripts are always cached by Node unless the server is restarted.
              const gRequire = createGRequire(scriptPath, gBoxConfig);

              for (const includedPath of app.config.default_include) {
                var includeScript = gRequire(includedPath);
                if (typeof includeScript === 'function') {
                  includeScript = await includeScript();
                }

                const store = als.getStore();
                if (store && store.$g && store.$g.isCompleted) {
                  // If a default include script (like the auth middleware) has sent a response,
                  // we must stop all further processing.
                  logger.info(`Request handled by default include '${includedPath}'. Halting execution.`);
                  return; // Exit the requestHandler.
                }
              }
            }

            const script = runInGBox(scriptPath, gBoxConfig);
            if (typeof script === 'function') {
              await script();
            } else {
              // This is a server configuration error, so we can throw it.
              throw new Error(`Script ${scriptPath} in app ${appName} did not export a function.`);
            }
          } catch (e) {
            logger.error(`Error executing script: ${scriptPath} in app ${appName}`, e);
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end(`INTERNAL_SERVER_ERROR - ${e.message}`);
          }
        } else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
          const indexPath = path.join(filePath, 'index.html');
          if (fs.existsSync(indexPath)) {
            res.writeHead(301, { 'Location': `${urlWithoutQuery}/index.html${queryString}` });
            res.end();
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('FILE_NOT_FOUND');
          }
        } else {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('FILE_NOT_FOUND');
        }
      }
    });
  } catch (err) {
    logger.error(`Error handling request for ${req.url}`, err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`INTERNAL_SERVER_ERROR - ${err.message}`);
  }
};

(async () => { //startup is now asynchronous
  // --- Ensure required directories exist ---
  const logsDir = path.join(projectRoot, 'logs');
  const settingsDir = path.join(projectRoot, 'settings');
  const backupsDir = path.join(projectRoot, 'backups');
  const tempDir = path.join(projectRoot, 'temp');
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
  if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir);
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  // --- Logger Setup ---
  const logger = winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    ),
    transports: [
      new winston.transports.DailyRotateFile({
        filename: 'logs/gingee-%DATE%.log',
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: `${config.logging.rotation.max_size_mb}m`,
        maxFiles: `${config.logging.rotation.period_days}d`
      })
    ]
  });

  // Initialize the app logger factory with the main server logger instance.
  appLogger.init(logger);

  // Initialize the cache service as configured, else fall back to in-memory cache
  await cache.init(config.cache, logger);

  const pdfStatus = pdf.init(); // Initialize the PDF module
  if (pdfStatus.error) {
    logger.error(`Failed to initialize PDF module: ${pdfStatus.error.message}`);
  }

  if (!fs.existsSync(webPath)) {
    // If the path does not exist, log a fatal error and exit.
    console.error(`FATAL: The configured web directory does not exist at: ${webPath}`);
    console.error("Please create the directory or correct the 'web' path in your gingee.json file.");
    process.exit(1); // Exit with a failure code
  }
  logger.info(`Serving from Web root folder: ${webPath}`);

  const apps = await initializeApps(config, logger, webPath);
  var appNames = Object.keys(apps);

  // --- Server Creation ---
  function handleServerError(error, port, protocol = 'HTTP') {
    if (error.code === 'EADDRINUSE') {
      const message = `FATAL: Port ${port} is already in use. \r\nPlease stop the other process or configure a different port in your gingee.json file.`;
      logger.error(message);
      console.error(message);
    } else {
      const message = `FATAL: Failed to start ${protocol} server on port ${port}.`;
      logger.error(message, { error: error.message, stack: error.stack });
      console.error(message);
      console.error(error);
    }
    process.exit(1);
  }

  // --- HTTP Server ---
  if (config.server.http.enabled) {
    try {
      const reqHandler = (req, res) => requestHandler(req, res, apps, config, logger);
      const httpServer = http.createServer(reqHandler);

      httpServer.on('error', (error) => {
        handleServerError(error, config.server.http.port, 'HTTP');
      });

      httpServer.listen(config.server.http.port, () => {
        const message = `Gingee HTTP server running on port ${config.server.http.port}`;
        logger.info(message);
        console.log(message);
      });
    } catch (err) {
      handleServerError(err, config.server.http.port, 'HTTP');
    }
  }

  // --- HTTPS Server ---
  if (config.server.https.enabled) {
    try {
      const keyPath = path.resolve(projectRoot, config.server.https.key_file);
      const certPath = path.resolve(projectRoot, config.server.https.cert_file);

      logger.info(`Attempting to load SSL key from: ${keyPath}`);
      logger.info(`Attempting to load SSL certificate from: ${certPath}`);

      const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      };
      
      const reqHandler = (req, res) => requestHandler(req, res, apps, config, logger);
      const httpsServer = https.createServer(options, reqHandler);

      httpsServer.on('error', (error) => {
        handleServerError(error, config.server.https.port, 'HTTPS');
      });

      httpsServer.listen(config.server.https.port, () => {
        const message = `Gingee HTTPS server running on port ${config.server.https.port}`;
        logger.info(message);
        console.log(message);
      });
    } catch (err) {
      // This will catch errors like missing SSL cert files
      handleServerError(err, config.server.https.port, 'HTTPS');
    }
  }
})().catch(err => {
  console.error('\nFATAL: An unhandled error occurred during Gingee startup.');
  console.error(err.stack || err.message);
  process.exit(1);
});

module.exports = { initializeApps, requestHandler }; // Export the app init and request handler for testing purposes
