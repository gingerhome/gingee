/**
 * @module engine/request/spa
 * @description SPA dev proxy and production fallback handling.
 * Engine-internal.
 */

const fs = require('fs');
const path = require('path');
const { createProxyMiddleware } = require('http-proxy-middleware');

/**
 * Handle SPA when no script target matched.
 * @returns {{ handled: boolean, filePath?: string }}
 *   handled=true means response already sent (or handed to proxy).
 *   filePath set means treat as static asset under SPA build path.
 */
function handleSpa(opts) {
  const { req, res, app, appName, urlParts, isDevelopment, logger } = opts;

  if (!(app.config.type === 'SPA' && app.config.spa && app.config.spa.enabled)) {
    return { handled: false };
  }

  if (isDevelopment) {
    if (app.config.spa.dev_server_proxy) {
      const proxy = createProxyMiddleware({
        target: app.config.spa.dev_server_proxy,
        changeOrigin: true,
        logLevel: 'silent'
      });
      proxy(req, res);
      return { handled: true };
    }
    logger.warn(`[SPA] App '${appName}' has no 'dev_server_proxy' configured in app.json.`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('INTERNAL SERVER ERROR - SPA app misconfigured. No dev_server_proxy set.');
    return { handled: true };
  }

  // Production: static asset under build or index fallback
  const buildPath = path.resolve(app.appWebPath, app.config.spa.build_path || './dist');
  const assetPath = path.join(buildPath, ...urlParts.slice(1));

  if (fs.existsSync(assetPath) && fs.statSync(assetPath).isFile()) {
    return { handled: false, filePath: assetPath };
  }

  const fallbackPath = path.resolve(buildPath, app.config.spa.fallback_path || 'index.html');
  if (fs.existsSync(fallbackPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    fs.createReadStream(fallbackPath).pipe(res);
    return { handled: true };
  }

  return { handled: false };
}

module.exports = {
  handleSpa
};
