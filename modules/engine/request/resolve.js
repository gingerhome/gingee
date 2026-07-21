/**
 * @module engine/request/resolve
 * @description Resolve app + target script path for an HTTP request.
 * Engine-internal.
 */

const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const metrics = require('../../metrics.js');

/**
 * Apply default_app rewrite for `/`.
 * Mutates req.url when applicable.
 */
function applyDefaultAppRoute(req, apps, config, logger) {
  const urlPath = req.url.split('?')[0];
  const queryIndex = req.url.indexOf('?');
  const queryString = queryIndex !== -1 ? req.url.substring(queryIndex) : '';

  if (urlPath === '/') {
    const defaultApp = config.default_app;
    if (defaultApp && apps[defaultApp]) {
      req.url = `/${defaultApp}/${queryString}`;
      logger.info(`Routing root request to default app '${defaultApp}'. New URL: ${req.url}`);
    }
  }

  const urlWithoutQuery = req.url.split('?')[0];
  const qIdx = req.url.indexOf('?');
  return {
    urlWithoutQuery,
    queryString: qIdx !== -1 ? req.url.substring(qIdx) : '',
    urlParts: urlWithoutQuery.split('/').filter(Boolean)
  };
}

/**
 * Resolve app from first path segment or SPA Referer.
 * @returns {{ appName: string, app: object|null, urlWithoutQuery: string, urlParts: string[], queryString: string }}
 */
function resolveApp(req, apps, config, logger) {
  const { urlWithoutQuery, queryString, urlParts } = applyDefaultAppRoute(
    req,
    apps,
    config,
    logger
  );

  let appName = urlParts[0];
  let app = apps[appName];

  if (!app && req.headers.referer) {
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

  return { appName, app, urlWithoutQuery, urlParts, queryString };
}

/**
 * Resolve script path via routes.json or file-based routing.
 */
function resolveScriptTarget(req, app, appName, urlWithoutQuery, urlParts) {
  let routeParams = null;
  let targetScriptFolder = null;
  let targetScriptPath = null;
  const requestPath = urlWithoutQuery.substring(appName.length + 1);

  if (app && app.compiledRoutes) {
    for (const route of app.compiledRoutes) {
      if (req.method === route.method || route.method === 'ALL') {
        const matchResult = route.matcher(requestPath);
        if (matchResult) {
          targetScriptPath = path.join(app.appBoxPath, route.script);
          routeParams = matchResult.params;
          targetScriptFolder = path.dirname(targetScriptPath);
          break;
        }
      }
    }
  }

  if (!targetScriptPath && !path.extname(requestPath)) {
    const potentialScriptPath = path.join(app.appBoxPath, ...urlParts.slice(1)) + '.js';
    if (fs.existsSync(potentialScriptPath)) {
      targetScriptPath = potentialScriptPath;
      targetScriptFolder = path.dirname(targetScriptPath);
    }
  }

  return { routeParams, targetScriptFolder, targetScriptPath, requestPath };
}

/**
 * Send 503 for maintenance; returns true if handled.
 */
function rejectIfMaintenance(res, app, appName, req, logger, requestStartedAt) {
  if (!(app && app.in_maintenance)) return false;
  logger.warn(`Request to '${req.url}' blocked because app '${appName}' is in maintenance mode.`);
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
  return true;
}

/**
 * Send APP_NOT_FOUND; returns true if handled.
 */
function rejectIfAppMissing(res, app, appName, requestStartedAt) {
  if (app) return false;
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('APP_NOT_FOUND');
  metrics.recordHttpRequest({
    app: appName || '_none',
    kind: 'other',
    statusCode: 404,
    durationSeconds: (Date.now() - requestStartedAt) / 1000
  });
  return true;
}

/**
 * Privilege-scoped view of apps for ALS store.
 */
function privilegeScope(config, appName, app, apps) {
  let allApps = apps;
  let appNames = Object.keys(apps);
  let isPrivileged = false;

  if (config.privileged_apps && !config.privileged_apps.includes(appName)) {
    appNames = [appName];
    allApps = { [appName]: app };
  }

  if (config.privileged_apps && config.privileged_apps.includes(appName)) {
    isPrivileged = true;
  }

  return { allApps, appNames, isPrivileged };
}

module.exports = {
  applyDefaultAppRoute,
  resolveApp,
  resolveScriptTarget,
  rejectIfMaintenance,
  rejectIfAppMissing,
  privilegeScope
};
