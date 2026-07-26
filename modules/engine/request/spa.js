/**
 * @module engine/request/spa
 * @description SPA dev proxy and production fallback handling.
 * Engine-internal.
 */

const fs = require("fs");
const { createProxyMiddleware } = require("http-proxy-middleware");
const {
  resolveConfinedPath,
  isInsideAppWeb,
  isInsideAppBox,
} = require("./path_confine.js");

/**
 * Handle SPA when no script target matched.
 * Build / asset / fallback paths are confined to app.appWebPath (never box).
 * @returns {object} `{ handled: boolean, filePath: string|undefined }` —
 *   handled=true means response already sent (or handed to proxy).
 *   filePath set means treat as static asset under SPA build path.
 */
function handleSpa(opts) {
  const { req, res, app, appName, urlParts, isDevelopment, logger } = opts;

  if (!(
    app.config.type === "SPA" &&
    app.config.spa &&
    app.config.spa.enabled
  )) {
    return { handled: false };
  }

  if (isDevelopment) {
    if (app.config.spa.dev_server_proxy) {
      const proxy = createProxyMiddleware({
        target: app.config.spa.dev_server_proxy,
        changeOrigin: true,
        logLevel: "silent",
      });
      proxy(req, res);
      return { handled: true };
    }
    logger.warn(
      `[SPA] App '${appName}' has no 'dev_server_proxy' configured in app.json.`,
    );
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end(
      "INTERNAL SERVER ERROR - SPA app misconfigured. No dev_server_proxy set.",
    );
    return { handled: true };
  }

  // Production: build_path must stay under app web root
  const buildPath = resolveConfinedPath(
    app.appWebPath,
    app.config.spa.build_path || "dist",
  );
  if (!buildPath) {
    logger.error(
      `[SPA] App '${appName}' spa.build_path escapes app web root; refusing to serve.`,
    );
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("INTERNAL SERVER ERROR - SPA app misconfigured (build_path).");
    return { handled: true };
  }

  const assetPath = resolveConfinedPath(buildPath, urlParts.slice(1));
  if (
    assetPath &&
    isInsideAppWeb(assetPath, app.appWebPath) &&
    !isInsideAppBox(assetPath, app.appBoxPath) &&
    fs.existsSync(assetPath) &&
    fs.statSync(assetPath).isFile()
  ) {
    return { handled: false, filePath: assetPath };
  }

  const fallbackPath = resolveConfinedPath(
    buildPath,
    app.config.spa.fallback_path || "index.html",
  );
  if (
    fallbackPath &&
    isInsideAppWeb(fallbackPath, app.appWebPath) &&
    !isInsideAppBox(fallbackPath, app.appBoxPath) &&
    fs.existsSync(fallbackPath)
  ) {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Cache-Control": "no-store",
    });
    fs.createReadStream(fallbackPath).pipe(res);
    return { handled: true };
  }

  return { handled: false };
}

module.exports = {
  handleSpa,
};
