/**
 * @module engine/app_cache_invalidate
 * @description Prefix-scoped invalidation of static file cache and gbox
 * transpile/instance caches for the calling app. Engine-internal.
 */

const path = require("path");
const cacheService = require("../cache_service.js");
const { clearScriptCachesByPrefixes } = require("../gbox.js");
const { SCOPES, resolveSecurePath, isPathInside } = require("../internal_utils.js");

/**
 * Resolve user path prefixes to absolute paths using fs BOX/WEB rules.
 * @param {string} scope - SCOPES.BOX or SCOPES.WEB
 * @param {string[]} prefixes
 * @param {object} app
 * @returns {string[]}
 */
function resolvePrefixes(scope, prefixes, app) {
  if (!Array.isArray(prefixes) || prefixes.length === 0) return [];
  const boundary = scope === SCOPES.BOX ? app.appBoxPath : app.appWebPath;
  const out = [];
  for (const raw of prefixes) {
    if (raw == null || raw === "") continue;
    const userPath = String(raw);
    const abs = resolveSecurePath(scope, userPath);
    if (!isPathInside(abs, boundary) && path.resolve(abs) !== path.resolve(boundary)) {
      throw new Error(
        `Path Traversal Error: Access to '${userPath}' is forbidden!`,
      );
    }
    out.push(abs);
  }
  return out;
}

/**
 * Clear static:${abs}… keys for each prefix via the cache provider.
 * @param {string[]} absPrefixes
 * @returns {Promise<number>} number of prefixes cleared
 */
async function invalidateStaticPrefixes(absPrefixes) {
  let n = 0;
  for (const abs of absPrefixes || []) {
    const keyPrefix = `static:${abs}`;
    await cacheService.clear(keyPrefix);
    n += 1;
  }
  return n;
}

/**
 * Clear transpile + instance caches for prefixes on this process.
 * @param {string} appName
 * @param {string[]} absPrefixes
 * @returns {{ transpile: number, instance: number }}
 */
function invalidateScriptPrefixesLocal(appName, absPrefixes) {
  return clearScriptCachesByPrefixes(appName, absPrefixes);
}

/**
 * Master-side apply: static provider clear + local script caches + broadcast to workers.
 * Prefixes must already be absolute jailed paths.
 * @param {string} appName
 * @param {string[]} staticAbsPrefixes
 * @param {string[]} scriptAbsPrefixes
 * @returns {Promise<{ static: number, scripts: { transpile: number, instance: number } }>}
 */
async function applyInvalidateOnMaster(
  appName,
  staticAbsPrefixes,
  scriptAbsPrefixes,
) {
  let staticCount = 0;
  if (staticAbsPrefixes && staticAbsPrefixes.length > 0) {
    staticCount = await invalidateStaticPrefixes(staticAbsPrefixes);
  }
  let scriptCounts = { transpile: 0, instance: 0 };
  if (scriptAbsPrefixes && scriptAbsPrefixes.length > 0) {
    scriptCounts = invalidateScriptPrefixesLocal(appName, scriptAbsPrefixes);
    try {
      const workerManager = require("./isolation/worker_manager.js");
      if (typeof workerManager.broadcastCacheInvalidate === "function") {
        workerManager.broadcastCacheInvalidate(appName, scriptAbsPrefixes);
      }
    } catch (_) {
      /* master without isolation */
    }
  }
  return { static: staticCount, scripts: scriptCounts };
}

module.exports = {
  SCOPES,
  resolvePrefixes,
  invalidateStaticPrefixes,
  invalidateScriptPrefixesLocal,
  applyInvalidateOnMaster,
};
