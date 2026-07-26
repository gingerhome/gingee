/**
 * @module scheduler_coordination
 * @description Multi-node scheduler coordination via Redis.
 *
 * Config shape matches queue/cache redis pattern (sibling blocks under scheduler):
 *
 *   "scheduler": {
 *     "coordination": { "driver": "none"|"redis", "strategy": "tick"|"leader", ... },
 *     "redis": { "url"|"host"/"port"/..., "key_prefix": "gingee:scheduler:" }
 *   }
 *
 * Strategies:
 * - <code>tick</code> (default): per app+job+fire-slot lock so only one node runs each occurrence.
 * - <code>leader</code>: global leader lease; only the leader runs any scheduled job.
 *
 * Fail-closed when Redis is required but unavailable (skip fire; log + metric).
 * Engine-internal — not for sandboxed require.
 */

const os = require('os');

/** Redis connection defaults — same field names as queue.redis / cache redis. */
const REDIS_DEFAULTS = {
  url: null,
  host: '127.0.0.1',
  port: 6379,
  password: null,
  db: 0,
  key_prefix: 'gingee:scheduler:'
};

const COORDINATION_DEFAULTS = {
  /** none | redis — same role as queue.driver / cache.provider */
  driver: 'none',
  strategy: 'tick', // tick | leader
  /** Lock / leader lease TTL (ms). Leader renews at ttl/3. */
  lock_ttl_ms: 300000,
  /**
   * Bucket size for tick slots when planned fire time is unavailable (ms).
   * Absorbs small clock skew between nodes.
   */
  slot_granularity_ms: 10000,
  /** Stable node identity for lock values / leader (default hostname:pid). */
  node_id: null
};

/**
 * Normalize redis connection object (queue/cache field set).
 * @param {object|null|undefined} raw
 * @returns {object}
 */
function normalizeRedis(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...REDIS_DEFAULTS,
    ...r,
    port: r.port != null ? Number(r.port) : REDIS_DEFAULTS.port,
    db: r.db != null ? Number(r.db) : REDIS_DEFAULTS.db,
    key_prefix:
      (r.key_prefix && String(r.key_prefix)) || REDIS_DEFAULTS.key_prefix
  };
}

/**
 * Normalize coordination + redis from a full scheduler config object.
 * Accepts legacy shapes for one release:
 *   - coordination.mode → coordination.driver
 *   - coordination.redis → scheduler.redis (merged under top-level redis)
 *
 * @param {object|null|undefined} schedulerOrCoord
 *   Full `scheduler` section preferred; also accepts a bare coordination object
 *   plus optional second arg (tests).
 * @param {object|null|undefined} [redisOverride]
 * @returns {{ driver: string, strategy: string, lock_ttl_ms: number, slot_granularity_ms: number, node_id: string, redis: object }}
 */
function normalizeCoordination(schedulerOrCoord, redisOverride) {
  const input =
    schedulerOrCoord && typeof schedulerOrCoord === 'object' && !Array.isArray(schedulerOrCoord)
      ? schedulerOrCoord
      : {};

  // Full scheduler section has .coordination; bare coordination has .driver/.mode/.strategy
  const looksLikeScheduler =
    input.coordination != null ||
    input.enabled !== undefined ||
    input.timezone !== undefined ||
    (input.redis != null && input.driver == null && input.mode == null);

  const coordRaw = looksLikeScheduler
    ? input.coordination && typeof input.coordination === 'object'
      ? input.coordination
      : {}
    : input;

  // driver (preferred) or legacy mode
  let driverRaw =
    coordRaw.driver != null
      ? coordRaw.driver
      : coordRaw.mode != null
        ? coordRaw.mode
        : COORDINATION_DEFAULTS.driver;
  const driver =
    String(driverRaw).toLowerCase() === 'redis' ? 'redis' : 'none';

  const strategy =
    coordRaw.strategy != null
      ? String(coordRaw.strategy).toLowerCase()
      : COORDINATION_DEFAULTS.strategy;

  const ttl = Number(coordRaw.lock_ttl_ms);
  const gran = Number(coordRaw.slot_granularity_ms);

  // redis: top-level scheduler.redis (preferred) > override > legacy coordination.redis
  const redisMerged = {
    ...REDIS_DEFAULTS,
    ...(coordRaw.redis && typeof coordRaw.redis === 'object' ? coordRaw.redis : {}),
    ...(looksLikeScheduler && input.redis && typeof input.redis === 'object'
      ? input.redis
      : {}),
    ...(redisOverride && typeof redisOverride === 'object' ? redisOverride : {})
  };

  return {
    driver,
    // keep mode alias for any old log/test readers
    mode: driver,
    strategy: strategy === 'leader' ? 'leader' : 'tick',
    lock_ttl_ms:
      Number.isFinite(ttl) && ttl >= 1000 ? Math.floor(ttl) : COORDINATION_DEFAULTS.lock_ttl_ms,
    slot_granularity_ms:
      Number.isFinite(gran) && gran >= 1000
        ? Math.floor(gran)
        : COORDINATION_DEFAULTS.slot_granularity_ms,
    node_id:
      coordRaw.node_id != null && String(coordRaw.node_id).trim()
        ? String(coordRaw.node_id).trim()
        : defaultNodeId(),
    redis: normalizeRedis(redisMerged)
  };
}

/**
 * @private
 */
function defaultNodeId() {
  return `${os.hostname()}:${process.pid}`;
}

/**
 * Compute a fire slot id for tick locks.
 * Prefers planned fire time from croner currentRun(); else wall clock bucketed.
 *
 * @param {object|null} runtime - scheduler job runtime (optional cronJob)
 * @param {number} granularityMs
 * @param {Date|number|null} [nowOverride] - tests
 * @returns {string}
 */
function computeFireSlot(runtime, granularityMs, nowOverride) {
  let t = null;
  try {
    if (runtime && runtime.cronJob && typeof runtime.cronJob.currentRun === 'function') {
      const cur = runtime.cronJob.currentRun();
      if (cur instanceof Date && !Number.isNaN(cur.getTime())) {
        t = cur.getTime();
      }
    }
  } catch (_) {
    /* ignore */
  }
  if (t == null) {
    if (nowOverride instanceof Date) t = nowOverride.getTime();
    else if (typeof nowOverride === 'number' && Number.isFinite(nowOverride)) t = nowOverride;
    else t = Date.now();
  }
  const g = granularityMs > 0 ? granularityMs : COORDINATION_DEFAULTS.slot_granularity_ms;
  return String(Math.floor(t / g) * g);
}

/**
 * @param {string} prefix
 * @param {string} appName
 * @param {string} jobName
 * @param {string} slot
 * @returns {string}
 */
function tickLockKey(prefix, appName, jobName, slot) {
  const p = prefix || REDIS_DEFAULTS.key_prefix;
  return `${p}lock:${appName}:${jobName}:${slot}`;
}

/**
 * @param {string} prefix
 * @returns {string}
 */
function leaderKey(prefix) {
  const p = prefix || REDIS_DEFAULTS.key_prefix;
  return `${p}leader`;
}

/**
 * Build an ioredis client the same way as queue_drivers/redis.js.
 * @param {object} redisCfg - normalized redis block
 * @param {object} logger
 * @returns {import('ioredis')}
 */
function createRedisClient(redisCfg, logger) {
  const Redis = require('ioredis');
  const r = redisCfg || {};
  let client;
  if (r.url || (typeof r === 'string' && r)) {
    const url = r.url || r;
    client = new Redis(String(url), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false
    });
  } else {
    client = new Redis({
      host: r.host || '127.0.0.1',
      port: r.port != null ? Number(r.port) : 6379,
      password: r.password || undefined,
      db: r.db != null ? Number(r.db) : 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    });
  }
  client.on('error', (err) => {
    (logger || console).error(`[scheduler:coord] Redis error: ${err.message}`);
  });
  return client;
}

/**
 * Redis-backed coordinator. Lazy-connects on first use.
 */
class RedisCoordinator {
  /**
   * @param {object} options - normalized coordination (includes .redis)
   * @param {object} [logger]
   */
  constructor(options, logger) {
    // Allow passing full scheduler section or already-normalized coord
    this.cfg =
      options && options.redis && (options.driver != null || options.mode != null)
        ? options.driver != null || options.strategy != null
          ? {
              ...options,
              driver: options.driver || options.mode,
              mode: options.driver || options.mode,
              redis: normalizeRedis(options.redis)
            }
          : normalizeCoordination(options)
        : normalizeCoordination(options);
    // Ensure driver field
    if (this.cfg.driver == null && this.cfg.mode != null) {
      this.cfg.driver = this.cfg.mode;
    }
    this.logger = logger || console;
    this.client = null;
    this._connecting = null;
    this._closed = false;
    this._isLeader = false;
    this._renewTimer = null;
  }

  enabled() {
    return (this.cfg.driver === 'redis' || this.cfg.mode === 'redis') && !this._closed;
  }

  nodeId() {
    return this.cfg.node_id;
  }

  isLeader() {
    return this._isLeader;
  }

  /**
   * @private
   */
  async ensureClient() {
    if (this._closed) throw new Error('Scheduler coordinator is shut down');
    if (this.client) return this.client;
    if (this._connecting) return this._connecting;

    this._connecting = (async () => {
      const client = createRedisClient(this.cfg.redis, this.logger);
      // Wait until ready (or fail) so first lock does not race a half-open socket.
      if (client.status !== 'ready') {
        await new Promise((resolve, reject) => {
          const onReady = () => {
            cleanup();
            resolve();
          };
          const onError = (err) => {
            cleanup();
            reject(err);
          };
          const cleanup = () => {
            client.removeListener('ready', onReady);
            client.removeListener('error', onError);
          };
          client.once('ready', onReady);
          client.once('error', onError);
        });
      }
      this.client = client;
      this.logger.info(
        `[scheduler:coord] Redis connected (strategy=${this.cfg.strategy}, node=${this.cfg.node_id}, prefix=${this.cfg.redis.key_prefix})`
      );
      if (this.cfg.strategy === 'leader') {
        await this._tryBecomeLeader();
        this._startLeaderRenew();
      }
      return client;
    })();

    try {
      return await this._connecting;
    } finally {
      this._connecting = null;
    }
  }

  /**
   * @private
   */
  async _tryBecomeLeader() {
    const client = this.client;
    if (!client) return false;
    const key = leaderKey(this.cfg.redis.key_prefix);
    const ttl = this.cfg.lock_ttl_ms;
    const res = await client.set(key, this.cfg.node_id, 'PX', ttl, 'NX');
    if (res === 'OK') {
      this._isLeader = true;
      this.logger.info(`[scheduler:coord] Acquired leader lease (${key})`);
      return true;
    }
    const holder = await client.get(key);
    if (holder === this.cfg.node_id) {
      await client.pexpire(key, ttl);
      this._isLeader = true;
      return true;
    }
    this._isLeader = false;
    return false;
  }

  /**
   * @private
   */
  _startLeaderRenew() {
    if (this._renewTimer) clearInterval(this._renewTimer);
    const period = Math.max(1000, Math.floor(this.cfg.lock_ttl_ms / 3));
    this._renewTimer = setInterval(() => {
      this._tryBecomeLeader().catch((e) => {
        this.logger.error(`[scheduler:coord] Leader renew failed: ${e.message}`);
        this._isLeader = false;
      });
    }, period);
    if (typeof this._renewTimer.unref === 'function') this._renewTimer.unref();
  }

  /**
   * Decide whether this node may run a scheduled job occurrence.
   *
   * @param {object} opts
   * @param {string} opts.appName
   * @param {string} opts.jobName
   * @param {object} [opts.runtime]
   * @returns {Promise<{ allow: boolean, reason: string, detail?: string }>}
   */
  async tryAllowRun(opts) {
    if (!this.enabled()) {
      return { allow: true, reason: 'none' };
    }

    let client;
    try {
      client = await this.ensureClient();
    } catch (e) {
      return {
        allow: false,
        reason: 'redis_error',
        detail: e.message || String(e)
      };
    }

    if (this.cfg.strategy === 'leader') {
      try {
        const ok = await this._tryBecomeLeader();
        if (ok) return { allow: true, reason: 'leader' };
        return { allow: false, reason: 'not_leader' };
      } catch (e) {
        return {
          allow: false,
          reason: 'redis_error',
          detail: e.message || String(e)
        };
      }
    }

    const slot = computeFireSlot(opts.runtime, this.cfg.slot_granularity_ms);
    const key = tickLockKey(
      this.cfg.redis.key_prefix,
      opts.appName,
      opts.jobName,
      slot
    );
    try {
      const res = await client.set(key, this.cfg.node_id, 'PX', this.cfg.lock_ttl_ms, 'NX');
      if (res === 'OK') {
        return { allow: true, reason: 'tick_lock', detail: key };
      }
      return { allow: false, reason: 'tick_held', detail: key };
    } catch (e) {
      return {
        allow: false,
        reason: 'redis_error',
        detail: e.message || String(e)
      };
    }
  }

  async shutdown() {
    this._closed = true;
    if (this._renewTimer) {
      clearInterval(this._renewTimer);
      this._renewTimer = null;
    }
    this._isLeader = false;
    if (this.client) {
      try {
        await this.client.quit();
      } catch (_) {
        try {
          this.client.disconnect();
        } catch (_) {
          /* ignore */
        }
      }
      this.client = null;
    }
  }
}

module.exports = {
  REDIS_DEFAULTS,
  COORDINATION_DEFAULTS,
  normalizeRedis,
  normalizeCoordination,
  computeFireSlot,
  tickLockKey,
  leaderKey,
  createRedisClient,
  RedisCoordinator,
  defaultNodeId
};
