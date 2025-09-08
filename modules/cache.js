// This is the secure, sandboxed cache module for application developers.
// It acts as a facade over the main cache_service.
const cacheService = require('./cache_service.js');
const { getContext } = require('./ginger.js');

/**
 * @module cache
 * @description Provides a secure interface for caching data within the GingerJS application context. 
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */


/**
 * Constructs a secure, namespaced cache key for the current app.
 * @private
 */
function _getNamespacedKey(key) {
    const { appName } = getContext();
    if (!key || typeof key !== 'string') {
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

module.exports = {
    get,
    set,
    del,
    clear
};
