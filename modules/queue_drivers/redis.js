/**
 * Redis list + delayed ZSET queue driver (multi-node safe claim via BRPOP).
 * Uses existing ioredis dependency.
 * @private
 */

const { randomUUID } = require('crypto');

/**
 * @param {object} opts
 * @param {object} opts.redis - ioredis connection options or url
 * @param {string} opts.keyPrefix
 * @param {function} opts.onReady - (job) => void
 * @param {object} opts.logger
 * @param {number} [opts.pollMs]
 */
function createRedisDriver(opts) {
  const Redis = require('ioredis');
  const log = opts.logger || console;
  const prefix = opts.keyPrefix || 'gingee:queue:';
  const pollMs = opts.pollMs != null ? opts.pollMs : 500;
  const onReady = opts.onReady;

  let client = null;
  let closed = false;
  let pollTimer = null;
  let brpopActive = false;

  const readyKey = () => `${prefix}ready`;
  const delayedKey = () => `${prefix}delayed`;
  const jobKey = (id) => `${prefix}job:${id}`;

  function connect() {
    const r = opts.redis || {};
    if (r.url || (typeof r === 'string' && r)) {
      const url = r.url || r;
      client = new Redis(url, {
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
      log.error(`[queue:redis] ${err.message}`);
    });
  }

  async function promoteDelayed() {
    if (!client || closed) return;
    const now = Date.now();
    // ZRANGEBYSCORE delayed 0 now LIMIT 0 20
    const ids = await client.zrangebyscore(delayedKey(), 0, now, 'LIMIT', 0, 32);
    for (const id of ids) {
      const moved = await client.zrem(delayedKey(), id);
      if (moved === 1) {
        await client.lpush(readyKey(), id);
      }
    }
  }

  async function pullLoop() {
    if (closed || !client || brpopActive) return;
    brpopActive = true;
    try {
      while (!closed) {
        await promoteDelayed();
        // BRPOP with short timeout so we can promote delayed and exit cleanly
        const res = await client.brpop(readyKey(), 1);
        if (closed) break;
        if (!res || !res[1]) continue;
        const id = res[1];
        const raw = await client.get(jobKey(id));
        if (!raw) continue;
        let job;
        try {
          job = JSON.parse(raw);
        } catch (_) {
          await client.del(jobKey(id));
          continue;
        }
        job.status = 'active';
        try {
          onReady(job);
        } catch (e) {
          log.error(`[queue:redis] onReady error: ${e.message}`);
        }
      }
    } catch (e) {
      if (!closed) log.error(`[queue:redis] pull loop: ${e.message}`);
    } finally {
      brpopActive = false;
    }
  }

  return {
    name: 'redis',

    async start() {
      connect();
      // Kick off consumer loop
      setImmediate(() => {
        pullLoop().catch((e) => log.error(`[queue:redis] ${e.message}`));
      });
      // Delayed promotion backup
      pollTimer = setInterval(() => {
        promoteDelayed().catch(() => {});
      }, pollMs);
      if (typeof pollTimer.unref === 'function') pollTimer.unref();
    },

    async enqueue(jobInput) {
      if (!client) throw new Error('Redis queue driver not started');
      const id = jobInput.id || randomUUID();
      const delayMs = jobInput.delayMs || 0;
      const job = {
        id,
        appName: jobInput.appName,
        name: jobInput.name,
        script: jobInput.script,
        payload: jobInput.payload,
        attempt: jobInput.attempt || 1,
        maxAttempts: jobInput.maxAttempts || 3,
        backoffMs: jobInput.backoffMs != null ? jobInput.backoffMs : 1000,
        runAt: Date.now() + delayMs,
        status: delayMs > 0 ? 'delayed' : 'waiting',
        createdAt: Date.now()
      };
      await client.set(jobKey(id), JSON.stringify(job), 'EX', 86400 * 7);
      if (delayMs > 0) {
        await client.zadd(delayedKey(), job.runAt, id);
      } else {
        await client.lpush(readyKey(), id);
      }
      return { id, name: job.name, appName: job.appName };
    },

    async retry(job) {
      const nextAttempt = (job.attempt || 1) + 1;
      const delay =
        (job.backoffMs || 1000) * Math.pow(2, Math.max(0, (job.attempt || 1) - 1));
      return this.enqueue({
        id: job.id,
        appName: job.appName,
        name: job.name,
        script: job.script,
        payload: job.payload,
        attempt: nextAttempt,
        maxAttempts: job.maxAttempts,
        backoffMs: job.backoffMs,
        delayMs: delay
      });
    },

    async complete(jobId) {
      if (client) await client.del(jobKey(jobId));
    },

    async fail(jobId) {
      if (client) {
        // Keep failed payload briefly for debugging
        const raw = await client.get(jobKey(jobId));
        if (raw) {
          try {
            const j = JSON.parse(raw);
            j.status = 'failed';
            await client.set(jobKey(jobId), JSON.stringify(j), 'EX', 86400);
          } catch (_) {
            await client.del(jobKey(jobId));
          }
        }
      }
    },

    async shutdown() {
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      if (client) {
        try {
          client.disconnect();
        } catch (_) {
          /* ignore */
        }
        client = null;
      }
    }
  };
}

module.exports = { createRedisDriver };
