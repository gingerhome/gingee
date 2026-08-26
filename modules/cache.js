// This is the secure, sandboxed cache module for application developers.
// It acts as a facade over the main cache_service.
const cacheService = require("./cache_service.js");
const { getContext } = require("./gingee.js");
const {
  SCOPES,
  resolvePrefixes,
  applyInvalidateOnMaster,
} = require("./engine/app_cache_invalidate.js");

/**
 * @module cache
 * @description Provides a secure interface for caching data within the Gingee application context.
 * Also exposes {@link module:cache.invalidateSysCache} to drop engine static/transpile/instance
 * caches for path prefixes under the calling app (after runtime file replaces).
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */

/** @type {Map<string, { resolve: Function, reject: Function, timer: NodeJS.Timeout }>} */
const pendingWorkerInvalidate = new Map();

const WORKER_INVALIDATE_ACK_MS = 15000;

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
 * True when running inside an isolation app_worker process.
 * @private
 */
function isIsolationWorker() {
  return (
    process.env.GINGEE_WORKER === "1" && typeof process.send === "function"
  );
}

/**
 * Forward resolved invalidate to the master; wait for ack.
 * @private
 */
function forwardInvalidateToMaster(appName, staticPrefixes, scriptPrefixes) {
  const requestId = `cinv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingWorkerInvalidate.delete(requestId);
      reject(
        new Error(
          "cache.invalidateSysCache: timed out waiting for master ack",
        ),
      );
    }, WORKER_INVALIDATE_ACK_MS);
    pendingWorkerInvalidate.set(requestId, { resolve, reject, timer });
    try {
      process.send({
        type: "cache_invalidate_from_worker",
        requestId,
        appName,
        static: staticPrefixes,
        scripts: scriptPrefixes,
      });
    } catch (e) {
      clearTimeout(timer);
      pendingWorkerInvalidate.delete(requestId);
      reject(e);
    }
  });
}

/**
 * @private Called from app_worker when master replies.
 * @param {object} msg
 * @returns {boolean}
 */
function _handleWorkerInvalidateAck(msg) {
  if (!msg || !msg.requestId) return false;
  const pending = pendingWorkerInvalidate.get(msg.requestId);
  if (!pending) return false;
  clearTimeout(pending.timer);
  pendingWorkerInvalidate.delete(msg.requestId);
  if (msg.error) {
    pending.reject(new Error(String(msg.error)));
  } else {
    pending.resolve(
      msg.result || { static: 0, scripts: { transpile: 0, instance: 0 } },
    );
  }
  return true;
}

/**
 * @function invalidateSysCache
 * @memberof module:cache
 * @description Drops engine caches for path prefixes under this app only — static
 * file cache entries (`static:…`) and/or box transpile + sandboxed module instance
 * caches. Does **not** run `platform.reloadApp` (no maintenance mode, no db/email
 * reinit). Path rules match `fs` (leading `/` = app WEB/BOX root; else relative to
 * the calling script). Empty options are a no-op. When called from an isolation
 * worker, prefixes are resolved locally then forwarded to the master (static clear
 * + fan-out to all workers).
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
  const { app, appName } = getContext();
  if (!app || !appName) {
    throw new Error("cache.invalidateSysCache requires an app context.");
  }

  const opts = options && typeof options === "object" ? options : {};
  const staticPrefixes = resolvePrefixes(
    SCOPES.WEB,
    Array.isArray(opts.static) ? opts.static : [],
    app,
  );
  const scriptPrefixes = resolvePrefixes(
    SCOPES.BOX,
    Array.isArray(opts.scripts) ? opts.scripts : [],
    app,
  );

  if (staticPrefixes.length === 0 && scriptPrefixes.length === 0) {
    return { static: 0, scripts: { transpile: 0, instance: 0 } };
  }

  if (isIsolationWorker()) {
    return forwardInvalidateToMaster(appName, staticPrefixes, scriptPrefixes);
  }

  return applyInvalidateOnMaster(appName, staticPrefixes, scriptPrefixes);
}

module.exports = {
  get,
  set,
  del,
  clear,
  invalidateSysCache,
  _handleWorkerInvalidateAck,
};
