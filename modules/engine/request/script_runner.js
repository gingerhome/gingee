/**
 * @module engine/request/script_runner
 * @description Concurrency gate + metrics + executeScript for server scripts.
 * Engine-internal.
 */

const fs = require("fs");
const path = require("path");
const limits = require("../../limits.js");
const metrics = require("../../metrics.js");
const { resolveAllowDynamicCodeForApp } = require("../../gbox.js");
const { executeScript } = require("./execute_script.js");
const {
  matchesNoCache,
  resolveCompiledCacheRegex,
} = require("./cache_config.js");

/**
 * Run a box server script for this request (or 404 if missing).
 *
 * @param {object} opts
 * @returns {Promise<void>}
 */
async function runServerScript(opts) {
  const {
    req,
    res,
    app,
    appName,
    scriptPath,
    webPath,
    engineRoot,
    config,
    logger,
    cacheConfig,
    requestStartedAt,
  } = opts;

  if (!scriptPath || !fs.existsSync(scriptPath)) {
    return false; // caller handles directory / 404
  }

  if (typeof logger.debug === "function") {
    logger.debug(`Executing script: ${scriptPath}`);
  }

  const acquire = limits.tryAcquireRequest(appName, app);
  if (!acquire.ok) {
    metrics.inc("gingee_limits_rejected_total", {
      scope: acquire.scope || "global",
    });
    if (!res.headersSent) {
      res.writeHead(acquire.statusCode || 503, {
        "Content-Type": "application/json",
        "Retry-After": "1",
      });
      res.end(
        JSON.stringify({
          error: "TOO_MANY_REQUESTS",
          scope: acquire.scope,
          message: acquire.message,
        }),
      );
    }
    metrics.recordHttpRequest({
      app: appName,
      kind: "script",
      statusCode: acquire.statusCode || 503,
      durationSeconds: (Date.now() - requestStartedAt) / 1000,
    });
    return true;
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
          kind: "script",
          statusCode: code,
          durationSeconds: (Date.now() - requestStartedAt) / 1000,
        });
      } catch (_) {
        /* ignore metrics errors */
      }
    };
    res.on("finish", done);
    res.on("close", done);
  };
  hookReleaseOnResponse();

  try {
    const serverCacheConfig = cacheConfig.server;
    let useCache = serverCacheConfig.enabled;
    const compiled = resolveCompiledCacheRegex(app, cacheConfig);

    if (useCache && matchesNoCache(compiled.serverNoCache, req.url)) {
      useCache = false;
    }

    if (!useCache) {
      try {
        delete require.cache[require.resolve(scriptPath)];
      } catch (_) {
        /* gbox entry — resolve may fail; ignore */
      }
      if (typeof logger.debug === "function") {
        logger.debug(`Reloading script (cache disabled): ${scriptPath}`);
      }
    }

    const appBoxPath = path.join(webPath, appName, "box");
    const globalModulesPath = path.join(engineRoot, "modules");
    const allowedBuiltinModules =
      (config.box && config.box.allowed_modules) || [];
    const privilegedApps = config.privileged_apps || [];
    const localModulesPaths =
      (config.box && config.box.localModulesPaths) || [];

    const gBoxConfig = {
      appName,
      app,
      appBoxPath,
      globalModulesPath,
      localModulesPaths,
      allowedBuiltinModules,
      privilegedApps,
      useCache,
      logger,
      globalConfig: config,
      allowDynamicCode: resolveAllowDynamicCodeForApp(config.box, app.config),
    };

    await executeScript({
      scriptPath,
      gBoxConfig,
      app,
      acquireToken: acquire.token,
      req,
      res,
      logger,
      useCache,
    });
  } catch (e) {
    logger.error(`Error executing script: ${scriptPath} in app ${appName}`, e);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "text/plain" });
      res.end(`INTERNAL_SERVER_ERROR - ${e.message}`);
    }
  }

  return true;
}

module.exports = {
  runServerScript,
};
