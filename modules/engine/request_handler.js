/**
 * @module engine/request_handler
 * @description HTTP request routing and dispatch (static, SPA, server scripts).
 * Engine-internal — not for sandboxed app require.
 *
 * Factory preserves the public signature:
 *   requestHandler(req, res, apps, config, logger)
 */

const path = require('path');
const { transpileCache } = require('../gbox.js');
const { als } = require('../gingee.js');
const metrics = require('../metrics.js');
const cache = require('../cache_service.js');
const { metricsScrapeHooks } = require('./metrics_hooks.js');
const { projectRoot } = require('./paths.js');
const {
  resolveApp,
  resolveScriptTarget,
  rejectIfMaintenance,
  rejectIfAppMissing,
  privilegeScope
} = require('./request/resolve.js');
const { handleSpa } = require('./request/spa.js');
const { serveStaticFile, serveDirectoryOr404 } = require('./request/static.js');
const { runServerScript } = require('./request/script_runner.js');

/**
 * @param {object} deps
 * @param {string} deps.webPath
 * @param {string} deps.engineRoot
 * @returns {function}
 */
function createRequestHandler(deps) {
  const webPath = deps.webPath;
  const engineRoot = deps.engineRoot;

  async function requestHandler(req, res, apps, config, logger) {
    const requestStartedAt = Date.now();
    try {
      if (metrics.tryHandleRequest(req, res, metricsScrapeHooks(apps))) {
        return;
      }

      const { appName, app, urlWithoutQuery, urlParts, queryString } = resolveApp(
        req,
        apps,
        config,
        logger
      );

      if (rejectIfMaintenance(res, app, appName, req, logger, requestStartedAt)) {
        return;
      }

      const { allApps, appNames, isPrivileged } = privilegeScope(config, appName, app, apps);

      if (rejectIfAppMissing(res, app, appName, requestStartedAt)) {
        return;
      }

      const { routeParams, targetScriptFolder, targetScriptPath } = resolveScriptTarget(
        req,
        app,
        appName,
        urlWithoutQuery,
        urlParts
      );

      als.run(
        {
          globalConfig: config,
          req,
          res,
          projectRoot,
          webPath,
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

          const acceptEncoding = req.headers['accept-encoding'] || '';
          const canCompress =
            config.content_encoding.enabled && acceptEncoding.includes('gzip');

          let filePath = path.join(webPath, ...urlParts);

          const defaultCacheConfig = {
            client: { enabled: false, no_cache_regex: [] },
            server: { enabled: false, no_cache_regex: [] }
          };

          const cacheConfig = app.config.cache || defaultCacheConfig;
          cacheConfig.client = cacheConfig.client || defaultCacheConfig.client;
          cacheConfig.server = cacheConfig.server || defaultCacheConfig.server;

          const isDevelopment = app.config.mode === 'development';
          if (!targetScriptPath) {
            const spaResult = handleSpa({
              req,
              res,
              app,
              appName,
              urlParts,
              isDevelopment,
              logger
            });
            if (spaResult.handled) return;
            if (spaResult.filePath) filePath = spaResult.filePath;
          }

          if (!targetScriptPath && path.extname(filePath)) {
            const headers = {};
            await serveStaticFile({
              req,
              res,
              filePath,
              cacheConfig,
              cache,
              canCompress,
              logger,
              headers
            });
            return;
          }

          const ran = await runServerScript({
            req,
            res,
            app,
            appName,
            scriptPath: targetScriptPath,
            webPath,
            engineRoot,
            config,
            logger,
            cacheConfig,
            requestStartedAt
          });
          if (ran) return;

          serveDirectoryOr404(res, filePath, urlWithoutQuery, queryString);
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
