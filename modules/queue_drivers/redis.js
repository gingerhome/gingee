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
  const dlqKey = () => `${prefix}dlq`;
  const jobKey = (id) => `${prefix}job:${id}`;
  const dlqTtlSec = opts.dlqTtlSec != null ? Number(opts.dlqTtlSec) : 86400 * 14;
  const dlqMax = opts.dlqMax != null ? Number(opts.dlqMax) : 1000;

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
      if (client) {
        await client.del(jobKey(jobId));
        await client.lrem(dlqKey(), 0, jobId);
      }
    },

    /**
     * Permanent failure → DLQ list + job hash.
     * @param {object} job
     * @param {Error|string} [err]
     */
    async deadLetter(job, err) {
      if (!client || !job || !job.id) return;
      const record = {
        ...job,
        status: 'failed',
        error: err ? err.message || String(err) : job.error || 'failed',
        failedAt: Date.now()
      };
      delete record._timer;
      await client.set(jobKey(record.id), JSON.stringify(record), 'EX', dlqTtlSec);
      await client.lrem(dlqKey(), 0, record.id);
      await client.lpush(dlqKey(), record.id);
      await client.ltrim(dlqKey(), 0, Math.max(0, dlqMax - 1));
    },

    async fail(jobId) {
      if (!client) return;
      const raw = await client.get(jobKey(jobId));
      if (!raw) return;
      try {
        const j = JSON.parse(raw);
        await this.deadLetter(j, j.error || 'failed');
      } catch (_) {
        await client.del(jobKey(jobId));
      }
    },

    async listDlq(opts = {}) {
      if (!client) return [];
      const limit = opts.limit != null ? Math.min(500, Math.max(1, Number(opts.limit))) : 100;
      const appFilter = opts.appName || null;
      const ids = await client.lrange(dlqKey(), 0, Math.max(limit * 3, 50) - 1);
      const out = [];
      for (const id of ids) {
        const raw = await client.get(jobKey(id));
        if (!raw) continue;
        try {
          const j = JSON.parse(raw);
          if (appFilter && j.appName !== appFilter) continue;
          out.push(j);
          if (out.length >= limit) break;
        } catch (_) {
          /* ignore */
        }
      }
      return out;
    },

    async getDlqJob(jobId) {
      if (!client) return null;
      const raw = await client.get(jobKey(jobId));
      if (!raw) return null;
      try {
        const j = JSON.parse(raw);
        return j.status === 'failed' ? j : null;
      } catch (_) {
        return null;
      }
    },

    async discardDlq(jobId) {
      if (!client) return false;
      const n = await client.lrem(dlqKey(), 0, jobId);
      await client.del(jobKey(jobId));
      return n > 0;
    },

    async retryDlq(jobId, opts = {}) {
      if (!client) return null;
      const rec = await this.getDlqJob(jobId);
      const raw = rec ? null : await client.get(jobKey(jobId));
      let j = rec;
      if (!j && raw) {
        try {
          j = JSON.parse(raw);
        } catch (_) {
          return null;
        }
      }
      if (!j) return null;
      await client.lrem(dlqKey(), 0, jobId);
      const maxAttempts =
        opts.maxAttempts != null
          ? Number(opts.maxAttempts)
          : Math.max(3, Number(j.maxAttempts) || 3);
      return this.enqueue({
        id: j.id,
        appName: j.appName,
        name: j.name,
        script: j.script,
        payload: j.payload,
        attempt: 1,
        maxAttempts,
        backoffMs: j.backoffMs,
        delayMs: 0,
        createdAt: j.createdAt
      });
    },

    async dlqSize(appName) {
      if (!client) return 0;
      if (!appName) return client.llen(dlqKey());
      const list = await this.listDlq({ appName, limit: 500 });
      return list.length;
    },

    /**
     * Ready list + delayed ZSET jobs (shared across nodes). Admin / Glade live view.
     * @param {object} [opts]
     * @param {string} [opts.appName]
     * @param {number} [opts.limit]
     * @returns {Promise<object[]>}
     */
    async listPending(opts = {}) {
      if (!client) return [];
      const limit = opts.limit != null ? Math.min(500, Math.max(1, Number(opts.limit))) : 100;
      const appFilter = opts.appName || null;
      const out = [];
      const seen = new Set();

      async function pushId(id, state, runAtHint) {
        if (!id || seen.has(id)) return;
        const raw = await client.get(jobKey(id));
        if (!raw) return;
        try {
          const j = JSON.parse(raw);
          if (appFilter && j.appName !== appFilter) return;
          seen.add(id);
          out.push({
            ...j,
            state,
            scope: 'driver',
            runAt: runAtHint != null ? Number(runAtHint) : j.runAt
          });
        } catch (_) {
          /* ignore */
        }
      }

      // Delayed first (soonest first)
      const delayed = await client.zrangebyscore(
        delayedKey(),
        '-inf',
        '+inf',
        'WITHSCORES',
        'LIMIT',
        0,
        Math.max(limit, 50)
      );
      for (let i = 0; i < delayed.length; i += 2) {
        if (out.length >= limit) break;
        await pushId(delayed[i], 'delayed', delayed[i + 1]);
      }

      // Ready list (LPUSH so LRANGE 0..n is newest first — reverse for FIFO-ish view)
      if (out.length < limit) {
        const readyIds = await client.lrange(readyKey(), 0, Math.max(limit * 2, 50) - 1);
        for (let i = readyIds.length - 1; i >= 0; i--) {
          if (out.length >= limit) break;
          await pushId(readyIds[i], 'pending', null);
        }
      }

      return out.slice(0, limit);
    },

    /**
     * @returns {Promise<{ pending: number, delayed: number }>}
     */
    async pendingCounts() {
      if (!client) return { pending: 0, delayed: 0 };
      const [pending, delayed] = await Promise.all([
        client.llen(readyKey()),
        client.zcard(delayedKey())
      ]);
      return {
        pending: Number(pending) || 0,
        delayed: Number(delayed) || 0
      };
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
