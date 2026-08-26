// This is the secure, sandboxed cache module for application developers.
// It acts as a facade over the main cache_service.
const cacheService = require("./cache_service.js");
const { getContext } = require("./gingee.js");
const {
  SCOPES,
  resolvePrefixes,
  invalidateStaticPrefixes,
  invalidateScriptPrefixesLocal,
} = require("./engine/app_cache_invalidate.js");

/**
 * @module cache
 * @description Provides a secure interface for caching data within the Gingee application context.
 * Also exposes {@link module:cache.invalidateSysCache} to drop engine static/transpile/instance
 * caches for path prefixes under the calling app (after runtime file replaces).
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */

/**
 * Constructs a secure, namespaced cache key for the current app.
 * @private
 */
function _getNamespacedKey(key) {
  const { appName } = getContext();
  if (!key || typeof key !== "string") {
    throw new Error("Cache key must be a non-empty string.");
  }
  return `${appName}:${key}`;
}

/**
 * @function get
 * @memberof module:cache
 * @description Retrieves a value from the application's cache using a namespaced key.
 * @param {string} key - The key to retrieve.
 * @returns {Promise<any>} A promise that resolves with the cached value, or null if not found.
 * @throws {Error} If the key is invalid or retrieval fails.
 * @example
 * const cache = require('cache');
 * const value = await cache.get('my_key');
 * if (value) {
 *    console.log(`Value found: ${JSON.stringify(value)}`);
 * } else {
 *    console.log("Key not found in cache.");
 * }
 */
async function get(key) {
  const namespacedKey = _getNamespacedKey(key);
  return cacheService.get(namespacedKey);
}

/**
 * @function set
 * @memberof module:cache
 * @description Stores a value in the application's cache.
 * @param {string} key - The key to store the value under.
 * @param {any} value - The JSON-serializable value to store.
 * @param {number} [ttl] - Optional Time-To-Live in seconds. Uses the server default if not provided.
 * @returns {Promise<void>}
 * @throws {Error} If the key is invalid or storage fails.
 * @example
 * const cache = require('cache');
 * await cache.set('my_key', { message: 'Hello, world!' }, 3600);
 * console.log("Value stored in cache.");
 */
async function set(key, value, ttl) {
  const namespacedKey = _getNamespacedKey(key);
  return cacheService.set(namespacedKey, value, ttl);
}

/**
 * @function del
 * @memberof module:cache
 * @description Deletes a value from the application's cache using a namespaced key.
 * @param {string} key - The key to delete.
 * @returns {Promise<void>}
 * @throws {Error} If the key is invalid or deletion fails.
 * @example
 * const cache = require('cache');
 * await cache.del('my_key');
 * console.log("Value deleted from cache.");
 */
async function del(key) {
  const namespacedKey = _getNamespacedKey(key);
  return cacheService.del(namespacedKey);
}

/**
 * @function clear
 * @memberof module:cache
 * @description Clears all cached values for the current application. This does not affect other applications' caches.
 * @returns {Promise<void>}
 * @throws {Error} If the clear operation fails.
 * @example
 * const cache = require('cache');
 * await cache.clear();
 * console.log("All cache cleared.");
 */
async function clear() {
  const { appName } = getContext();
  const prefix = `${appName}:`;
  return cacheService.clear(prefix);
}

/**
 * @function invalidateSysCache
 * @memberof module:cache
 * @description Drops engine caches for path prefixes under this app only — static
 * file cache entries (`static:…`) and/or box transpile + sandboxed module instance
 * caches. Does **not** run `platform.reloadApp` (no maintenance mode, no db/email
 * reinit). Path rules match `fs` (leading `/` = app WEB/BOX root; else relative to
 * the calling script). Empty options are a no-op. Script-cache clears fan out to
 * isolation workers.
 * @param {object} [options]
 * @param {string[]} [options.static] - Prefixes under app web (fs.WEB rules).
 * @param {string[]} [options.scripts] - Prefixes under app box (fs.BOX rules).
 * @returns {Promise<{ static: number, scripts: { transpile: number, instance: number } }>}
 * @example
 * const cache = require('cache');
 * await cache.invalidateSysCache({
 *   static: ['/assets/build'],
 *   scripts: ['/lib', './generated'],
 * });
 */
async function invalidateSysCache(options) {
  const { app, appName, logger } = getContext();
  if (!app || !appName) {
    throw new Error("cache.invalidateSysCache requires an app context.");
  }

  const opts = options && typeof options === "object" ? options : {};
  const staticRaw = opts.static;
  const scriptsRaw = opts.scripts;

  const staticPrefixes = resolvePrefixes(
    SCOPES.WEB,
    Array.isArray(staticRaw) ? staticRaw : [],
    app,
  );
  const scriptPrefixes = resolvePrefixes(
    SCOPES.BOX,
    Array.isArray(scriptsRaw) ? scriptsRaw : [],
    app,
  );

  let staticCount = 0;
  if (staticPrefixes.length > 0) {
    staticCount = await invalidateStaticPrefixes(staticPrefixes);
  }

  let scriptCounts = { transpile: 0, instance: 0 };
  if (scriptPrefixes.length > 0) {
    scriptCounts = invalidateScriptPrefixesLocal(appName, scriptPrefixes);
    try {
      const workerManager = require("./engine/isolation/worker_manager.js");
      if (typeof workerManager.broadcastCacheInvalidate === "function") {
        workerManager.broadcastCacheInvalidate(appName, scriptPrefixes);
      }
    } catch (e) {
      if (logger && logger.warn) {
        logger.warn(
          `[cache] invalidateSysCache worker fan-out skipped: ${e.message}`,
        );
      }
    }
  }

  return { static: staticCount, scripts: scriptCounts };
}

module.exports = {
  get,
  set,
  del,
  clear,
  invalidateSysCache,
};
