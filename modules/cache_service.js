const path = require("path");
let activeAdapter;
let cacheSvcConfig;
/** @type {object|null} */
let serviceLogger = null;
/** Last successfully initialized provider name */
let activeProvider = null;

/**
 * Whether Redis init failure should abort (true) or fall back to memory (false).
 * Default: fail closed when provider is redis.
 * @param {object} cacheConfig
 * @param {string} provider
 * @returns {boolean}
 */
function resolveFailClosed(cacheConfig, provider) {
  const c = cacheConfig && typeof cacheConfig === "object" ? cacheConfig : {};
  const v = c.fail_closed;
  if (v === true || v === "true" || v === 1 || v === "1") return true;
  if (v === false || v === "false" || v === 0 || v === "0") return false;
  // Default: redis is fail-closed; memory has nothing to fall back from
  return String(provider).toLowerCase() === "redis";
}

async function init(cacheConfig = {}, logger) {
  serviceLogger = logger || console;
  const log = serviceLogger;
  const provider = String(
    (cacheConfig && cacheConfig.provider) || "memory",
  ).toLowerCase();
  const failClosed = resolveFailClosed(cacheConfig, provider);

  let adapterPath;

  if (provider === "redis") {
    adapterPath = path.join(__dirname, "cache_drivers", "redis_adapter.js");
  } else {
    adapterPath = path.join(__dirname, "cache_drivers", "memory_adapter.js");
  }

  try {
    const adapter = require(adapterPath);
    await adapter.init(cacheConfig, log);
    activeAdapter = adapter;
    cacheSvcConfig = cacheConfig;
    activeProvider = provider;
    log.info(
      `[Cache] Successfully initialized with provider: '${provider}'` +
        (provider === "redis" ? ` (fail_closed=${failClosed})` : ""),
    );
  } catch (e) {
    if (provider === "redis") {
      if (failClosed) {
        const err = new Error(
          `[Cache] Redis provider failed and fail_closed=true (no memory fallback): ${e.message}`,
        );
        err.code = "CACHE_REDIS_FAIL_CLOSED";
        err.cause = e;
        log.error(err.message);
        activeAdapter = null;
        activeProvider = null;
        throw err;
      }
      log.error(
        `[Cache] Redis provider failed (${e.message}); fail_closed=false — falling back to memory (NOT multi-node safe; sessions will be node-local)`,
      );
      const memoryAdapter = require(
        path.join(__dirname, "cache_drivers", "memory_adapter.js"),
      );
      await Promise.resolve(memoryAdapter.init(cacheConfig, log));
      cacheSvcConfig = cacheConfig;
      activeAdapter = memoryAdapter;
      activeProvider = "memory";
      return;
    }
    // Memory (or unknown) init failure is always fatal
    log.error(
      `[Cache] ERROR: Could not initialize cache provider '${provider}'. Error: ${e.message}`,
    );
    throw e;
  }
}

function assertReady() {
  if (!activeAdapter) {
    throw new Error("Cache service is not initialized");
  }
}

async function get(key) {
  assertReady();
  const result = await activeAdapter.get(key);
  return result ? JSON.parse(result) : null;
}

async function set(key, value, ttl) {
  assertReady();
  ttl = ttl || (cacheSvcConfig && cacheSvcConfig.ttl) || 3600; // Default TTL is 3600 seconds (1 hour)
  return activeAdapter.set(key, JSON.stringify(value), ttl);
}

async function del(key) {
  assertReady();
  return activeAdapter.del(key);
}

async function clear(prefix = "") {
  assertReady();
  return activeAdapter.clear(prefix);
}

/** @returns {string|null} */
function getProvider() {
  return activeProvider;
}

module.exports = {
  init,
  get,
  set,
  del,
  clear,
  getProvider,
  resolveFailClosed,
};
