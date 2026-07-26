/**
 * Redis list + delayed/processing ZSET queue driver.
 *
 * Claim model (crash-safe):
 * - Ready list: LPUSH / BRPOP
 * - On claim: ZADD processing score=now+visibilityTimeout
 * - complete / deadLetter / retry: ZREM processing
 * - Reclaim loop: expired processing scores → LPUSH ready again
 * - releaseClaim: return a claimed job to ready (shutdown drain of waitQueue)
 *
 * Uses existing ioredis dependency. Pass opts.client to inject a mock for tests.
 * @private
 */

const { randomUUID } = require("crypto");

/**
 * Atomic DLQ discard:
 * KEYS[1]=dlq list, KEYS[2]=job key, KEYS[3]=processing zset
 * ARGV[1]=jobId
 * Returns 1 if discarded, 0 if not on DLQ (does not delete live job hashes).
 */
const LUA_DISCARD_DLQ = `
local n = redis.call('LREM', KEYS[1], 0, ARGV[1])
if n > 0 then
  redis.call('DEL', KEYS[2])
  redis.call('ZREM', KEYS[3], ARGV[1])
  return 1
end
return 0
`;

/**
 * Atomic DLQ retry claim + re-queue:
 * KEYS[1]=dlq, KEYS[2]=job key, KEYS[3]=ready list,
 * KEYS[4]=delayed zset, KEYS[5]=processing zset
 * ARGV[1]=jobId, ARGV[2]=maxAttempts (0 = keep), ARGV[3]=nowMs, ARGV[4]=ttlSec
 * Returns job JSON string or false if not available / not failed.
 * Only one concurrent caller wins the LREM.
 */
const LUA_RETRY_DLQ = `
local id = ARGV[1]
local n = redis.call('LREM', KEYS[1], 0, id)
if n == 0 then
  return false
end
local raw = redis.call('GET', KEYS[2])
if not raw then
  return false
end
local ok, job = pcall(cjson.decode, raw)
if not ok or type(job) ~= 'table' then
  redis.call('DEL', KEYS[2])
  return false
end
if job['status'] ~= 'failed' then
  -- Not a DLQ record; put id back and leave hash alone
  redis.call('LPUSH', KEYS[1], id)
  return false
end
redis.call('ZREM', KEYS[5], id)
redis.call('LREM', KEYS[3], 0, id)
redis.call('ZREM', KEYS[4], id)
local maxA = tonumber(ARGV[2]) or 0
if maxA > 0 then
  job['maxAttempts'] = maxA
end
job['status'] = 'waiting'
job['attempt'] = 1
job['error'] = nil
job['failedAt'] = nil
job['claimedAt'] = nil
job['reclaimAt'] = nil
job['runAt'] = tonumber(ARGV[3]) or 0
local newRaw = cjson.encode(job)
local ttl = tonumber(ARGV[4]) or 604800
redis.call('SET', KEYS[2], newRaw, 'EX', ttl)
redis.call('LPUSH', KEYS[3], id)
return newRaw
`;

/**
 * Wait until Redis is ready or reject (for fail-closed boot).
 * Injected mock clients may skip status and just ping.
 * @param {object} client
 * @param {number} timeoutMs
 */
function waitUntilReady(client, timeoutMs) {
  if (!client) {
    return Promise.reject(new Error("Redis client not created"));
  }
  // Already open
  if (client.status === "ready") {
    return client.ping
      ? client.ping().then(() => undefined)
      : Promise.resolve();
  }
  // Test mocks without status: try ping if present
  if (client.status == null && typeof client.ping === "function") {
    return client.ping().then(() => undefined);
  }
  if (client.status == null && typeof client.ping !== "function") {
    // Injected mock without ping — assume ready
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error(`Redis connection timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      if (typeof client.removeListener === "function") {
        client.removeListener("ready", onReady);
        client.removeListener("error", onError);
      }
    }
    function onReady() {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }
    function onError(err) {
      if (settled) return;
      settled = true;
      cleanup();
      reject(
        err instanceof Error
          ? err
          : new Error(String(err && err.message ? err.message : err)),
      );
    }

    if (typeof client.once === "function") {
      client.once("ready", onReady);
      client.once("error", onError);
    } else if (typeof client.on === "function") {
      client.on("ready", onReady);
      client.on("error", onError);
    } else {
      settled = true;
      clearTimeout(timer);
      resolve();
    }

    // Race a ping for clients already connecting
    if (typeof client.ping === "function") {
      client
        .ping()
        .then(() => onReady())
        .catch(() => {
          /* wait for ready/error events */
        });
    }
  });
}

/**
 * @param {object} opts
 * @param {object} [opts.redis] - ioredis connection options or { url }
 * @param {object} [opts.client] - injected Redis client (tests)
 * @param {string} opts.keyPrefix
 * @param {function} opts.onReady - (job) => void
 * @param {object} opts.logger
 * @param {number} [opts.pollMs]
 * @param {number} [opts.visibilityTimeoutMs] - claim lease before reclaim (default 5m)
 * @param {number} [opts.reclaimIntervalMs] - how often to scan processing ZSET
 * @param {number} [opts.connectTimeoutMs] - ready wait (default 5000)
 */
function createRedisDriver(opts) {
  const log = opts.logger || console;
  const prefix = opts.keyPrefix || "gingee:queue:";
  const pollMs = opts.pollMs != null ? Number(opts.pollMs) : 500;
  const visibilityTimeoutMs =
    opts.visibilityTimeoutMs != null
      ? Math.max(1000, Number(opts.visibilityTimeoutMs) || 300000)
      : 300000;
  const reclaimIntervalMs =
    opts.reclaimIntervalMs != null
      ? Math.max(200, Number(opts.reclaimIntervalMs) || 5000)
      : Math.max(1000, Math.min(pollMs * 10, 10000));
  const onReady = opts.onReady;

  let client = null;
  let closed = false;
  /** When true, stop BRPOP / onReady (shutdown phase) */
  let consuming = true;
  let pollTimer = null;
  let reclaimTimer = null;
  let brpopActive = false;

  const readyKey = () => `${prefix}ready`;
  const delayedKey = () => `${prefix}delayed`;
  const processingKey = () => `${prefix}processing`;
  const dlqKey = () => `${prefix}dlq`;
  const jobKey = (id) => `${prefix}job:${id}`;
  const dlqTtlSec =
    opts.dlqTtlSec != null ? Number(opts.dlqTtlSec) : 86400 * 14;
  const dlqMax = opts.dlqMax != null ? Number(opts.dlqMax) : 1000;

  function connect() {
    if (opts.client) {
      client = opts.client;
      return;
    }
    const Redis = require("ioredis");
    const r = opts.redis || {};
    if (r.url || (typeof r === "string" && r)) {
      const url = r.url || r;
      client = new Redis(url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
        lazyConnect: false,
      });
    } else {
      client = new Redis({
        host: r.host || "127.0.0.1",
        port: r.port != null ? Number(r.port) : 6379,
        password: r.password || undefined,
        db: r.db != null ? Number(r.db) : 0,
        maxRetriesPerRequest: null,
        enableReadyCheck: true,
      });
    }
    client.on("error", (err) => {
      log.error(`[queue:redis] ${err.message}`);
    });
  }

  async function saveJob(job, ttlSec) {
    const ttl = ttlSec != null ? ttlSec : 86400 * 7;
    const copy = { ...job };
    delete copy._timer;
    await client.set(jobKey(job.id), JSON.stringify(copy), "EX", ttl);
  }

  async function markProcessing(id) {
    const reclaimAt = Date.now() + visibilityTimeoutMs;
    await client.zadd(processingKey(), reclaimAt, id);
    return reclaimAt;
  }

  async function clearProcessing(id) {
    if (!client || !id) return;
    await client.zrem(processingKey(), id);
  }

  async function promoteDelayed() {
    if (!client || closed) return;
    const now = Date.now();
    const ids = await client.zrangebyscore(
      delayedKey(),
      0,
      now,
      "LIMIT",
      0,
      32,
    );
    for (const id of ids) {
      const moved = await client.zrem(delayedKey(), id);
      if (moved === 1) {
        await client.lpush(readyKey(), id);
      }
    }
  }

  /**
   * Reclaim jobs whose processing lease expired (worker crash / hang).
   */
  async function reclaimStale() {
    if (!client || closed) return 0;
    const now = Date.now();
    const ids = await client.zrangebyscore(
      processingKey(),
      0,
      now,
      "LIMIT",
      0,
      32,
    );
    let n = 0;
    for (const id of ids) {
      const removed = await client.zrem(processingKey(), id);
      if (removed !== 1) continue;
      const raw = await client.get(jobKey(id));
      if (!raw) continue;
      let job;
      try {
        job = JSON.parse(raw);
      } catch (_) {
        await client.del(jobKey(id));
        continue;
      }
      // Do not reclaim DLQ / already failed records
      if (job.status === "failed") continue;
      job.status = "waiting";
      job.reclaimedAt = now;
      delete job.claimedAt;
      delete job.reclaimAt;
      await saveJob(job);
      await client.lpush(readyKey(), id);
      n++;
      log.warn(
        `[queue:redis] Reclaimed stale claim id=${id} app=${job.appName || "?"} job=${job.name || "?"}`,
      );
    }
    return n;
  }

  async function pullLoop() {
    if (closed || !client || brpopActive) return;
    brpopActive = true;
    try {
      while (!closed && consuming) {
        await promoteDelayed();
        // BRPOP with short timeout so we can promote delayed, reclaim, and exit cleanly
        const res = await client.brpop(readyKey(), 1);
        if (closed || !consuming) {
          // If we claimed after stop, put back
          if (res && res[1]) {
            await client.lpush(readyKey(), res[1]);
          }
          break;
        }
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
        if (job.status === "failed") {
          // Stray id on ready list
          continue;
        }
        const reclaimAt = await markProcessing(id);
        job.status = "active";
        job.claimedAt = Date.now();
        job.reclaimAt = reclaimAt;
        await saveJob(job);
        try {
          if (consuming && !closed) {
            onReady(job);
          } else {
            // Shutdown raced claim — return to ready
            await releaseClaimInternal(job);
          }
        } catch (e) {
          log.error(`[queue:redis] onReady error: ${e.message}`);
          try {
            await releaseClaimInternal(job);
          } catch (_) {
            /* ignore */
          }
        }
      }
    } catch (e) {
      if (!closed) log.error(`[queue:redis] pull loop: ${e.message}`);
    } finally {
      brpopActive = false;
    }
  }

  /**
   * @param {object} job
   */
  async function releaseClaimInternal(job) {
    if (!client || !job || !job.id) return false;
    await clearProcessing(job.id);
    const raw = await client.get(jobKey(job.id));
    let record = job;
    if (raw) {
      try {
        record = JSON.parse(raw);
      } catch (_) {
        record = job;
      }
    }
    if (record.status === "failed") {
      return false;
    }
    record.status = "waiting";
    delete record.claimedAt;
    delete record.reclaimAt;
    await saveJob(record);
    // Avoid duplicate list entries
    await client.lrem(readyKey(), 0, job.id);
    await client.lpush(readyKey(), job.id);
    return true;
  }

  return {
    name: "redis",
    visibilityTimeoutMs,

    async start() {
      connect();
      consuming = true;
      closed = false;
      // Fail fast if Redis is unreachable (supports queue.fail_closed)
      await waitUntilReady(
        client,
        opts.connectTimeoutMs != null ? opts.connectTimeoutMs : 5000,
      );
      setImmediate(() => {
        pullLoop().catch((e) => log.error(`[queue:redis] ${e.message}`));
      });
      pollTimer = setInterval(() => {
        promoteDelayed().catch(() => {});
      }, pollMs);
      if (typeof pollTimer.unref === "function") pollTimer.unref();

      reclaimTimer = setInterval(() => {
        reclaimStale().catch((e) =>
          log.error(`[queue:redis] reclaim: ${e.message}`),
        );
      }, reclaimIntervalMs);
      if (typeof reclaimTimer.unref === "function") reclaimTimer.unref();
    },

    /** Stop BRPOP / delivering new jobs (graceful shutdown step 1). */
    async stopConsuming() {
      consuming = false;
    },

    /**
     * Extend processing lease while a long job runs.
     * @param {string} jobId
     */
    async extendVisibility(jobId) {
      if (!client || !jobId || closed) return false;
      const score = await client.zscore(processingKey(), jobId);
      if (score == null) return false;
      const reclaimAt = Date.now() + visibilityTimeoutMs;
      await client.zadd(processingKey(), reclaimAt, jobId);
      const raw = await client.get(jobKey(jobId));
      if (raw) {
        try {
          const j = JSON.parse(raw);
          j.reclaimAt = reclaimAt;
          await saveJob(j);
        } catch (_) {
          /* ignore */
        }
      }
      return true;
    },

    /**
     * Return a claimed job to the ready list (wait-queue drain on shutdown).
     * @param {object|string} jobOrId
     */
    async releaseClaim(jobOrId) {
      const job = typeof jobOrId === "string" ? { id: jobOrId } : jobOrId;
      return releaseClaimInternal(job);
    },

    /** Test / ops hook */
    async _reclaimStale() {
      return reclaimStale();
    },

    async enqueue(jobInput) {
      if (!client) throw new Error("Redis queue driver not started");
      const id = jobInput.id || randomUUID();
      const delayMs = jobInput.delayMs || 0;
      // Drop any prior processing claim when re-enqueuing same id (retry / maintenance)
      await clearProcessing(id);
      await client.lrem(readyKey(), 0, id);
      await client.zrem(delayedKey(), id);

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
        status: delayMs > 0 ? "delayed" : "waiting",
        createdAt: jobInput.createdAt || Date.now(),
      };
      await saveJob(job);
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
        (job.backoffMs || 1000) *
        Math.pow(2, Math.max(0, (job.attempt || 1) - 1));
      await clearProcessing(job.id);
      return this.enqueue({
        id: job.id,
        appName: job.appName,
        name: job.name,
        script: job.script,
        payload: job.payload,
        attempt: nextAttempt,
        maxAttempts: job.maxAttempts,
        backoffMs: job.backoffMs,
        delayMs: delay,
        createdAt: job.createdAt,
      });
    },

    async complete(jobId) {
      if (client) {
        await clearProcessing(jobId);
        await client.del(jobKey(jobId));
        await client.lrem(dlqKey(), 0, jobId);
        await client.lrem(readyKey(), 0, jobId);
        await client.zrem(delayedKey(), jobId);
      }
    },

    /**
     * Permanent failure → DLQ list + job hash.
     * @param {object} job
     * @param {Error|string} [err]
     */
    async deadLetter(job, err) {
      if (!client || !job || !job.id) return;
      await clearProcessing(job.id);
      await client.lrem(readyKey(), 0, job.id);
      await client.zrem(delayedKey(), job.id);
      const record = {
        ...job,
        status: "failed",
        error: err ? err.message || String(err) : job.error || "failed",
        failedAt: Date.now(),
      };
      delete record._timer;
      delete record.claimedAt;
      delete record.reclaimAt;
      await client.set(
        jobKey(record.id),
        JSON.stringify(record),
        "EX",
        dlqTtlSec,
      );
      await client.lrem(dlqKey(), 0, record.id);
      await client.lpush(dlqKey(), record.id);
      await client.ltrim(dlqKey(), 0, Math.max(0, dlqMax - 1));
    },

    async fail(jobId) {
      if (!client) return;
      const raw = await client.get(jobKey(jobId));
      if (!raw) {
        await clearProcessing(jobId);
        return;
      }
      try {
        const j = JSON.parse(raw);
        await this.deadLetter(j, j.error || "failed");
      } catch (_) {
        await clearProcessing(jobId);
        await client.del(jobKey(jobId));
      }
    },

    async listDlq(opts = {}) {
      if (!client) return [];
      const limit =
        opts.limit != null
          ? Math.min(500, Math.max(1, Number(opts.limit)))
          : 100;
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
        return j.status === "failed" ? j : null;
      } catch (_) {
        return null;
      }
    },

    /**
     * Atomically remove a job from the DLQ and delete its hash.
     * Safe if jobId is not on DLQ (does not touch live job payloads).
     * @param {string} jobId
     * @returns {Promise<boolean>}
     */
    async discardDlq(jobId) {
      if (!client || !jobId) return false;
      const id = String(jobId);
      if (typeof client.eval === "function") {
        const n = await client.eval(
          LUA_DISCARD_DLQ,
          3,
          dlqKey(),
          jobKey(id),
          processingKey(),
          id,
        );
        return Number(n) > 0;
      }
      // Fallback (non-atomic) for limited mocks
      const n = await client.lrem(dlqKey(), 0, id);
      if (n > 0) {
        await client.del(jobKey(id));
        await clearProcessing(id);
      }
      return n > 0;
    },

    /**
     * Atomically claim a DLQ job and re-queue it (attempt 1).
     * Concurrent retries: only one caller receives a job; others get null.
     * @param {string} jobId
     * @param {object} [opts]
     * @param {number} [opts.maxAttempts]
     * @returns {Promise<object|null>} enqueue-shaped result
     */
    async retryDlq(jobId, opts = {}) {
      if (!client || !jobId) return null;
      const id = String(jobId);
      const maxAttemptsArg =
        opts.maxAttempts != null
          ? Math.max(1, Number(opts.maxAttempts) || 3)
          : 0;
      // When not provided, use max(3, existing) after claim — pass 0 to mean "read from job"
      const now = Date.now();
      const ttlSec = 86400 * 7;

      if (typeof client.eval === "function") {
        // If maxAttempts not set, peek job first for default budget (read-only), then claim
        let maxForScript = maxAttemptsArg;
        if (maxForScript === 0) {
          const rec = await this.getDlqJob(id);
          if (!rec) return null;
          maxForScript = Math.max(3, Number(rec.maxAttempts) || 3);
        }
        const raw = await client.eval(
          LUA_RETRY_DLQ,
          5,
          dlqKey(),
          jobKey(id),
          readyKey(),
          delayedKey(),
          processingKey(),
          id,
          String(maxForScript),
          String(now),
          String(ttlSec),
        );
        if (!raw || raw === false || raw === "false") return null;
        let j;
        try {
          j = typeof raw === "string" ? JSON.parse(raw) : raw;
        } catch (_) {
          return null;
        }
        // Job is already on ready list with updated hash — notify local consumer via promote path
        // (BRPOP will pick it up). Return enqueue-shaped result.
        return { id: j.id || id, name: j.name, appName: j.appName };
      }

      // Fallback non-atomic path
      const rec = await this.getDlqJob(id);
      if (!rec) return null;
      const n = await client.lrem(dlqKey(), 0, id);
      if (n === 0) return null;
      const maxAttempts =
        opts.maxAttempts != null
          ? Number(opts.maxAttempts)
          : Math.max(3, Number(rec.maxAttempts) || 3);
      return this.enqueue({
        id: rec.id,
        appName: rec.appName,
        name: rec.name,
        script: rec.script,
        payload: rec.payload,
        attempt: 1,
        maxAttempts,
        backoffMs: rec.backoffMs,
        delayMs: 0,
        createdAt: rec.createdAt,
      });
    },

    async dlqSize(appName) {
      if (!client) return 0;
      if (!appName) return client.llen(dlqKey());
      const list = await this.listDlq({ appName, limit: 500 });
      return list.length;
    },

    /**
     * Ready + delayed + processing (claimed leases) for Glade live view.
     * @param {object} [opts]
     */
    async listPending(opts = {}) {
      if (!client) return [];
      const limit =
        opts.limit != null
          ? Math.min(500, Math.max(1, Number(opts.limit)))
          : 100;
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
            scope: "driver",
            runAt: runAtHint != null ? Number(runAtHint) : j.runAt,
          });
        } catch (_) {
          /* ignore */
        }
      }

      // Processing claims (visibility leases)
      const processing = await client.zrangebyscore(
        processingKey(),
        "-inf",
        "+inf",
        "WITHSCORES",
        "LIMIT",
        0,
        Math.max(limit, 50),
      );
      for (let i = 0; i < processing.length; i += 2) {
        if (out.length >= limit) break;
        await pushId(processing[i], "processing", processing[i + 1]);
      }

      // Delayed first (soonest first)
      if (out.length < limit) {
        const delayed = await client.zrangebyscore(
          delayedKey(),
          "-inf",
          "+inf",
          "WITHSCORES",
          "LIMIT",
          0,
          Math.max(limit, 50),
        );
        for (let i = 0; i < delayed.length; i += 2) {
          if (out.length >= limit) break;
          await pushId(delayed[i], "delayed", delayed[i + 1]);
        }
      }

      // Ready list
      if (out.length < limit) {
        const readyIds = await client.lrange(
          readyKey(),
          0,
          Math.max(limit * 2, 50) - 1,
        );
        for (let i = readyIds.length - 1; i >= 0; i--) {
          if (out.length >= limit) break;
          await pushId(readyIds[i], "pending", null);
        }
      }

      return out.slice(0, limit);
    },

    async pendingCounts() {
      if (!client) return { pending: 0, delayed: 0, processing: 0 };
      const [pending, delayed, processing] = await Promise.all([
        client.llen(readyKey()),
        client.zcard(delayedKey()),
        client.zcard(processingKey()),
      ]);
      return {
        pending: Number(pending) || 0,
        delayed: Number(delayed) || 0,
        processing: Number(processing) || 0,
      };
    },

    async shutdown() {
      consuming = false;
      closed = true;
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
      if (reclaimTimer) clearInterval(reclaimTimer);
      reclaimTimer = null;
      // Wait briefly for brpop loop to exit
      const start = Date.now();
      while (brpopActive && Date.now() - start < 2000) {
        await new Promise((r) => setTimeout(r, 20));
      }
      if (client) {
        try {
          if (typeof client.quit === "function") {
            await client.quit().catch(() => {
              if (typeof client.disconnect === "function") client.disconnect();
            });
          } else if (typeof client.disconnect === "function") {
            client.disconnect();
          }
        } catch (_) {
          /* ignore */
        }
        client = null;
      }
    },
  };
}

module.exports = { createRedisDriver };
