/**
 * @module engine/request_handler
 * @description HTTP request routing and dispatch (static, SPA, server scripts).
 * Engine-internal — not for sandboxed app require.
 *
 * Factory preserves the public signature:
 *   requestHandler(req, res, apps, config, logger)
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { URL } = require('url');
const { createProxyMiddleware } = require('http-proxy-middleware');
const mimeTypes = require('mime-types');
const { createGRequire, runInGBox, transpileCache } = require('../gbox.js');
const { als } = require('../gingee.js');
const limits = require('../limits.js');
const metrics = require('../metrics.js');
const cache = require('../cache_service.js');
const { metricsScrapeHooks } = require('./metrics_hooks.js');
const { projectRoot } = require('./paths.js');

/**
 * @param {object} deps
 * @param {string} deps.webPath - absolute web root
 * @param {string} deps.engineRoot - absolute engine package root
 * @returns {function}
 */
function createRequestHandler(deps) {
  const webPath = deps.webPath;
  const engineRoot = deps.engineRoot;

  /**
   * @param {import('http').IncomingMessage} req
   * @param {import('http').ServerResponse} res
   * @param {object} apps
   * @param {object} config
   * @param {object} logger
   */
  async function requestHandler(req, res, apps, config, logger) {
    const requestStartedAt = Date.now();
    try {
      // Engine metrics endpoint (before app routing). Default: localhost-only.
      if (metrics.tryHandleRequest(req, res, metricsScrapeHooks(apps))) {
        return;
      }

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
      let appName = urlParts[0];
      let app = apps[appName];

      if (!app && req.headers.referer) {
        // Attempt SPA context inference from Referer header
        try {
          const refererUrl = new URL(req.headers.referer);
          const refererPathParts = refererUrl.pathname.split('/').filter(Boolean);
          const contextualAppName = refererPathParts[0];
          const contextualApp = apps[contextualAppName];

          if (contextualApp && contextualApp.config.type === 'SPA') {
            app = contextualApp;
            appName = contextualAppName;
            logger.info(
              `[SPA Context] Inferred app '${appName}' from Referer header for request: ${req.url}`
            );
          }
        } catch (e) {
          logger.warn(`Could not parse Referer header: ${req.headers.referer}`);
        }
      }

      if (app && app.in_maintenance) {
        logger.warn(
          `Request to '${req.url}' blocked because app '${appName}' is in maintenance mode.`
        );
        res.writeHead(503, { 'Content-Type': 'text/html' });
        res.end(
          '<h1>503 Service Unavailable</h1><p>This application is currently undergoing maintenance. Please try again shortly.</p>'
        );
        metrics.recordHttpRequest({
          app: appName,
          kind: 'other',
          statusCode: 503,
          durationSeconds: (Date.now() - requestStartedAt) / 1000
        });
        return;
      }

      const headers = {};
      let ctxWebPath = webPath; // Default to the global webPath
      let allApps = apps; // Default to the full apps object
      let appNames = Object.keys(apps); // Default to all app names
      let isPrivileged = false;

      if (config.privileged_apps && !config.privileged_apps.includes(appName)) {
        appNames = [appName];
        allApps = { [appName]: app }; // Only include the current app
      }

      if (config.privileged_apps && config.privileged_apps.includes(appName)) {
        isPrivileged = true;
      }

      if (!app) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('APP_NOT_FOUND');
        metrics.recordHttpRequest({
          app: appName || '_none',
          kind: 'other',
          statusCode: 404,
          durationSeconds: (Date.now() - requestStartedAt) / 1000
        });
        return;
      }

      let routeParams = null;
      let targetScriptFolder = null;
      let targetScriptPath = null;
      const requestPath = urlWithoutQuery.substring(appName.length + 1); // Get path relative to the app

      if (app && app.compiledRoutes) {
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

      als.run(
        {
          globalConfig: config,
          req,
          res,
          projectRoot,
          webPath: ctxWebPath,
          appName,
          isPrivileged,
          app,
          allApps,
          appNames,
          logger: app.logger,
          routeParams,
          scriptPath: targetScriptPath,
          scriptFolder: targetScriptFolder,
          staticFileCache: cache,
          transpileCache,
          maxBodySize: config.max_body_size
        },
        async () => {
          if (req.url.includes(`/${appName}/box`)) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('ACCESS_DENIED');
            return;
          }

          // Determine if compression should be used for this request
          const acceptEncoding = req.headers['accept-encoding'] || '';
          const canCompress = config.content_encoding.enabled && acceptEncoding.includes('gzip');

          let filePath = path.join(webPath, ...urlParts);

          const defaultCacheConfig = {
            client: { enabled: false, no_cache_regex: [] },
            server: { enabled: false, no_cache_regex: [] }
          };

          const cacheConfig = app.config.cache || defaultCacheConfig;
          // Ensure nested objects exist to prevent errors
          cacheConfig.client = cacheConfig.client || defaultCacheConfig.client;
          cacheConfig.server = cacheConfig.server || defaultCacheConfig.server;

          const isDevelopment = app.config.mode === 'development';
          if (!targetScriptPath && app.config.type === 'SPA' && app.config.spa && app.config.spa.enabled) {
            if (isDevelopment) {
              // --- Development: Proxy to Vite/Angular CLI ---
              if (app.config.spa.dev_server_proxy) {
                const proxy = createProxyMiddleware({
                  target: app.config.spa.dev_server_proxy,
                  changeOrigin: true,
                  logLevel: 'silent' // Keeps the console clean
                });

                return proxy(req, res); // Hand off the request to the proxy
              } else {
                logger.warn(
                  `[SPA] App '${appName}' has no 'dev_server_proxy' configured in app.json.`
                );
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('INTERNAL SERVER ERROR - SPA app misconfigured. No dev_server_proxy set.');
                return;
              }
            } else {
              // --- Production: Serve static assets or fallback to index.html ---
              const buildPath = path.resolve(app.appWebPath, app.config.spa.build_path || './dist');
              const assetPath = path.join(buildPath, ...urlParts.slice(1));

              if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
                // It's a direct request for a static asset (e.g., a JS or CSS file)
                filePath = assetPath; // Reuse static file logic below
              } else {
                // It's a client-side route, so serve the fallback path (index.html)
                const fallbackPath = path.resolve(
                  buildPath,
                  app.config.spa.fallback_path || 'index.html'
                );
                if (fs.existsSync(fallbackPath)) {
                  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
                  fs.createReadStream(fallbackPath).pipe(res);
                  return;
                }
              }
            }
          }

          //if targetScriptPath then go to script execution
          if (!targetScriptPath && path.extname(filePath)) {
            const serverCacheConfig = cacheConfig.server;
            let useCache = serverCacheConfig.enabled;
            const cacheKey = `static:${filePath}`;

            let cacheEntry;
            if (useCache) {
              // Check if the path matches a no-cache rule
              const isNoCachePath = serverCacheConfig.no_cache_regex.some((r) =>
                new RegExp(r).test(req.url)
              );
              if (isNoCachePath) {
                useCache = false;
                logger.info(`No-cache rule matched for path: ${req.url}`);
              } else {
                // Try to get the cached file content
                cacheEntry = await cache.get(cacheKey);
              }
            }

            if (useCache && cacheEntry) {
              headers['Content-Type'] =
                cacheEntry.contentType ||
                mimeTypes.contentType(path.extname(filePath)) ||
                'application/octet-stream';
              logger.info(`[CACHE HIT] Serving static file: ${filePath}`);

              if (
                cacheConfig.client.enabled &&
                !cacheConfig.client.no_cache_regex.some((r) => new RegExp(r).test(req.url))
              ) {
                headers['Cache-Control'] = 'public, max-age=31536000';
              }

              const content = Buffer.from(cacheEntry.content, 'base64');
              if (canCompress) {
                zlib.gzip(content, (err, compressedData) => {
                  if (err) {
                    res.writeHead(200, headers);
                    res.end(content);
                  } else {
                    headers['Content-Encoding'] = 'gzip';
                    res.writeHead(200, headers);
                    res.end(compressedData);
                  }
                });
              } else {
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
                const outHeaders = { 'Content-Type': contentType };

                if (useCache) {
                  cache.set(cacheKey, { contentType, content: data.toString('base64') });
                  logger.info(`[CACHE SET] Caching static file: ${filePath}`);
                }

                if (
                  cacheConfig.client.enabled &&
                  !cacheConfig.client.no_cache_regex.some((r) => new RegExp(r).test(req.url))
                ) {
                  outHeaders['Cache-Control'] = 'public, max-age=31536000';
                } else {
                  outHeaders['Cache-Control'] = 'no-store';
                }

                if (canCompress) {
                  zlib.gzip(data, (err2, compressedData) => {
                    if (err2) {
                      res.writeHead(200, outHeaders);
                      res.end(data);
                    } else {
                      outHeaders['Content-Encoding'] = 'gzip';
                      res.writeHead(200, outHeaders);
                      res.end(compressedData);
                    }
                  });
                } else {
                  res.writeHead(200, outHeaders);
                  res.end(data);
                }
              }
            });
          } else {
            // Server script or directory
            const scriptPath = targetScriptPath;
            if (fs.existsSync(scriptPath)) {
              logger.info(`Executing script: ${scriptPath}`);

              // Concurrency gate (server scripts only; static files are not counted).
              const acquire = limits.tryAcquireRequest(appName, app);
              if (!acquire.ok) {
                metrics.inc('gingee_limits_rejected_total', {
                  scope: acquire.scope || 'global'
                });
                if (!res.headersSent) {
                  res.writeHead(acquire.statusCode || 503, {
                    'Content-Type': 'application/json',
                    'Retry-After': '1'
                  });
                  res.end(
                    JSON.stringify({
                      error: 'TOO_MANY_REQUESTS',
                      scope: acquire.scope,
                      message: acquire.message
                    })
                  );
                }
                metrics.recordHttpRequest({
                  app: appName,
                  kind: 'script',
                  statusCode: acquire.statusCode || 503,
                  durationSeconds: (Date.now() - requestStartedAt) / 1000
                });
                return;
              }

              const releaseOnce = () => limits.releaseRequest(acquire.token);
              let releaseHooked = false;
              let metricsRecorded = false;
              const hookReleaseOnResponse = () => {
                if (releaseHooked) return;
                releaseHooked = true;
                const done = () => {
                  releaseOnce();
                  if (metricsRecorded) return;
                  metricsRecorded = true;
                  try {
                    const code = res.statusCode || 200;
                    metrics.recordHttpRequest({
                      app: appName,
                      kind: 'script',
                      statusCode: code,
                      durationSeconds: (Date.now() - requestStartedAt) / 1000
                    });
                  } catch (_) {
                    /* ignore metrics errors */
                  }
                };
                res.on('finish', done);
                res.on('close', done);
              };
              hookReleaseOnResponse();

              try {
                // --- Server Script Cache Logic ---
                const serverCacheConfig = cacheConfig.server;
                let useCache = serverCacheConfig.enabled;

                if (useCache) {
                  const isNoCachePath = serverCacheConfig.no_cache_regex.some((r) =>
                    new RegExp(r).test(req.url)
                  );
                  if (isNoCachePath) {
                    useCache = false;
                  }
                }

                if (!useCache) {
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
                  logger,
                  globalConfig: config,
                  // undefined → gbox default (true); only false disables
                  allowCodeGeneration: !config.box || config.box.allow_code_generation !== false
                };

                // Request budget + AbortSignal for this script invocation.
                const store = als.getStore();
                if (store) {
                  limits.attachRequestContext(store, acquire.token, res);
                }

                if (app.config.default_include) {
                  // Note: default_include scripts are always cached by Node unless the server is restarted.
                  const gRequire = createGRequire(scriptPath, gBoxConfig);

                  for (const includedPath of app.config.default_include) {
                    var includeScript = gRequire(includedPath);
                    if (typeof includeScript === 'function') {
                      includeScript = await includeScript();
                    }

                    const includeStore = als.getStore();
                    if (includeStore && includeStore.$g && includeStore.$g.isCompleted) {
                      logger.info(
                        `Request handled by default include '${includedPath}'. Halting execution.`
                      );
                      return; // Exit the requestHandler (release on res finish/close).
                    }
                  }
                }

                const script = runInGBox(scriptPath, gBoxConfig);
                if (typeof script === 'function') {
                  await script();
                } else {
                  throw new Error(
                    `Script ${scriptPath} in app ${appName} did not export a function.`
                  );
                }
              } catch (e) {
                logger.error(`Error executing script: ${scriptPath} in app ${appName}`, e);
                if (!res.headersSent) {
                  res.writeHead(500, { 'Content-Type': 'text/plain' });
                  res.end(`INTERNAL_SERVER_ERROR - ${e.message}`);
                }
              }
            } else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
              const indexPath = path.join(filePath, 'index.html');
              if (fs.existsSync(indexPath)) {
                res.writeHead(301, {
                  Location: `${urlWithoutQuery}/index.html${queryString}`
                });
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
        }
      );
    } catch (err) {
      logger.error(`Error handling request for ${req.url}`, err);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end(`INTERNAL_SERVER_ERROR - ${err.message}`);
        metrics.recordHttpRequest({
          app: '_engine',
          kind: 'other',
          statusCode: 500,
          durationSeconds: (Date.now() - requestStartedAt) / 1000
        });
      }
    }
  }

  return requestHandler;
}

module.exports = {
  createRequestHandler
};
