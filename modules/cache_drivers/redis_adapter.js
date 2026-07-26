/**
 * Redis cache adapter.
 * Connection config uses the same shape as queue.redis / scheduler.redis:
 * nested under cache.redis, with optional url or host/port/password/db.
 *
 * Accepts full cache section from cache_service.init (provider, prefix, redis, …)
 * or a bare redis options object (tests / legacy).
 */

const Redis = require('ioredis');

let redis;

/**
 * Resolve ioredis constructor args from cache config.
 * Prefers nested `config.redis`; falls back to top-level host/port/url for legacy flat configs.
 *
 * @param {object} config
 * @returns {{ kind: 'url', url: string, options: object } | { kind: 'options', options: object }}
 */
function resolveRedisConnection(config = {}) {
  const nested =
    config.redis && typeof config.redis === 'object' && !Array.isArray(config.redis)
      ? config.redis
      : null;
  // Prefer nested cache.redis; else treat config itself as redis options (legacy / tests).
  const r = nested || config;

  const shared = {
    enableReadyCheck: true,
    connectTimeout: 3000,
    maxRetriesPerRequest: null
  };

  if (r.url || (typeof r === 'string' && r)) {
    return {
      kind: 'url',
      url: String(r.url || r),
      options: shared
    };
  }

  return {
    kind: 'options',
    options: {
      host: r.host || '127.0.0.1',
      port: r.port != null ? Number(r.port) : 6379,
      password: r.password || undefined,
      db: r.db != null ? Number(r.db) : 0,
      ...shared
    }
  };
}

/**
 * @param {object} config - full cache section or redis connection object
 * @param {object} logger
 */
async function init(config = {}, logger) {
  const log = logger || console;
  const conn = resolveRedisConnection(config);

  if (conn.kind === 'url') {
    redis = new Redis(conn.url, conn.options);
  } else {
    redis = new Redis(conn.options);
  }

  return new Promise((resolve, reject) => {
    redis.on('ready', () => {
      log.info(
        conn.kind === 'url'
          ? 'Redis cache adapter connected and ready (url).'
          : `Redis cache adapter connected and ready (${conn.options.host}:${conn.options.port}).`
      );
      redis.removeAllListeners('error');
      resolve();
    });

    redis.on('error', (err) => {
      const errorMessage = `Redis initial connection failed: ${err.message}`;
      log.error(errorMessage);
      redis.removeAllListeners('ready');
      try {
        redis.disconnect();
      } catch (_) {
        /* ignore */
      }
      reject(new Error(errorMessage));
    });
  });
}

async function get(key) {
  return redis.get(key);
}

async function set(key, value, ttl) {
  await redis.set(key, value, 'EX', ttl);
}

async function del(key) {
  await redis.del(key);
}

async function clear(prefix = '') {
  const stream = redis.scanStream({ match: `${prefix}*`, count: 100 });
  const keysToDelete = [];
  await new Promise((resolve, reject) => {
    stream.on('data', (keys) => keysToDelete.push(...keys));
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  if (keysToDelete.length > 0) {
    await redis.del(keysToDelete);
  }
}

module.exports = {
  init,
  get,
  set,
  del,
  clear,
  // test helper
  _resolveRedisConnection: resolveRedisConnection
};
