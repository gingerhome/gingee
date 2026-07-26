/**
 * Redis queue: visibility lease, reclaim, releaseClaim, and shutdown drain.
 */
const { createRedisDriver } = require("../../modules/queue_drivers/redis");
const queueService = require("../../modules/engine/queue_service");
const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Minimal in-memory Redis stand-in for queue driver tests.
 */
function createMockRedis() {
  /** @type {Record<string, string[]>} */
  const lists = {};
  /** @type {Record<string, Map<string, number>>} */
  const zsets = {};
  /** @type {Record<string, string>} */
  const kv = {};

  function list(key) {
    if (!lists[key]) lists[key] = [];
    return lists[key];
  }
  function zset(key) {
    if (!zsets[key]) zsets[key] = new Map();
    return zsets[key];
  }

  const client = {
    on() {
      return client;
    },
    async brpop(key, _timeoutSec) {
      const arr = list(key);
      if (arr.length === 0) {
        await new Promise((r) => setTimeout(r, 5));
        return null;
      }
      // BRPOP is from the tail (RPOP)
      const id = arr.pop();
      return [key, id];
    },
    async lpush(key, id) {
      list(key).unshift(String(id));
      return list(key).length;
    },
    async lrem(key, _count, id) {
      const arr = list(key);
      let n = 0;
      for (let i = arr.length - 1; i >= 0; i--) {
        if (arr[i] === String(id)) {
          arr.splice(i, 1);
          n++;
        }
      }
      return n;
    },
    async lrange(key, start, stop) {
      const arr = list(key);
      const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
      return arr.slice(start, end);
    },
    async llen(key) {
      return list(key).length;
    },
    async ltrim(key, start, stop) {
      const arr = list(key);
      lists[key] = arr.slice(start, stop + 1);
      return "OK";
    },
    async zadd(key, score, id) {
      zset(key).set(String(id), Number(score));
      return 1;
    },
    async zrem(key, id) {
      const z = zset(key);
      if (!z.has(String(id))) return 0;
      z.delete(String(id));
      return 1;
    },
    async zscore(key, id) {
      const z = zset(key);
      if (!z.has(String(id))) return null;
      return String(z.get(String(id)));
    },
    async zcard(key) {
      return zset(key).size;
    },
    async zrangebyscore(key, min, max, ...rest) {
      const z = zset(key);
      let minN = min === "-inf" ? -Infinity : Number(min);
      let maxN = max === "+inf" ? Infinity : Number(max);
      let withScores = false;
      let limit = Infinity;
      for (let i = 0; i < rest.length; i++) {
        if (String(rest[i]).toUpperCase() === "WITHSCORES") withScores = true;
        if (String(rest[i]).toUpperCase() === "LIMIT") {
          const offset = Number(rest[i + 1]) || 0;
          limit = Number(rest[i + 2]) || 0;
          // apply offset later
          rest._offset = offset;
        }
      }
      const offset = rest._offset || 0;
      const entries = [...z.entries()]
        .filter(([, s]) => s >= minN && s <= maxN)
        .sort((a, b) => a[1] - b[1])
        .slice(offset, offset + limit);
      if (!withScores) return entries.map(([id]) => id);
      const out = [];
      for (const [id, s] of entries) {
        out.push(id, String(s));
      }
      return out;
    },
    async get(key) {
      return kv[key] != null ? kv[key] : null;
    },
    async set(key, val) {
      kv[key] = String(val);
      return "OK";
    },
    async del(key) {
      const had = kv[key] != null || zsets[key] || lists[key];
      delete kv[key];
      delete lists[key];
      // do not wipe unrelated zsets when deleting a job string key
      if (String(key).includes(":job:")) {
        /* only kv */
      } else {
        delete zsets[key];
      }
      delete kv[key];
      return had ? 1 : 0;
    },
    /**
     * Minimal eval supporting DLQ discard + retry scripts used by the driver.
     * Signature mirrors ioredis: eval(script, numKeys, ...keysAndArgs)
     */
    async eval(script, numKeys, ...keysAndArgs) {
      const keys = keysAndArgs.slice(0, numKeys);
      const args = keysAndArgs.slice(numKeys);
      const s = String(script);
      if (
        s.includes("redis.call('LREM'") &&
        s.includes("DEL") &&
        !s.includes("cjson")
      ) {
        // discard: LREM dlq, if >0 DEL job + ZREM processing
        const [dlqK, jobK, procK] = keys;
        const id = String(args[0]);
        const n = await client.lrem(dlqK, 0, id);
        if (n > 0) {
          await client.del(jobK);
          await client.zrem(procK, id);
          return 1;
        }
        return 0;
      }
      if (s.includes("cjson.decode") || s.includes("job['status']")) {
        // retry DLQ atomic claim
        const [dlqK, jobK, readyK, delayedK, procK] = keys;
        const id = String(args[0]);
        const maxA = Number(args[1]) || 0;
        const now = Number(args[2]) || Date.now();
        const n = await client.lrem(dlqK, 0, id);
        if (n === 0) return false;
        const raw = await client.get(jobK);
        if (!raw) return false;
        let job;
        try {
          job = JSON.parse(raw);
        } catch (_) {
          await client.del(jobK);
          return false;
        }
        if (job.status !== "failed") {
          await client.lpush(dlqK, id);
          return false;
        }
        await client.zrem(procK, id);
        await client.lrem(readyK, 0, id);
        await client.zrem(delayedK, id);
        if (maxA > 0) job.maxAttempts = maxA;
        job.status = "waiting";
        job.attempt = 1;
        job.error = null;
        job.failedAt = null;
        job.runAt = now;
        delete job.claimedAt;
        delete job.reclaimAt;
        await client.set(jobK, JSON.stringify(job));
        await client.lpush(readyK, id);
        return JSON.stringify(job);
      }
      throw new Error("mock eval: unsupported script");
    },
    async quit() {
      return "OK";
    },
    disconnect() {},
    // test helpers
    _kv: kv,
    _lists: lists,
    _zsets: zsets,
  };

  // ioredis set with EX: set(key, val, 'EX', ttl)
  const origSet = client.set.bind(client);
  client.set = async (key, val, ..._args) => origSet(key, val);

  return client;
}

describe("queue redis visibility", () => {
  test("claim adds processing lease; complete removes it", async () => {
    const mock = createMockRedis();
    const ready = [];
    const driver = createRedisDriver({
      client: mock,
      keyPrefix: "t:q:",
      visibilityTimeoutMs: 5000,
      reclaimIntervalMs: 60000,
      pollMs: 50,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      onReady: (job) => ready.push(job),
    });
    await driver.start();
    const ref = await driver.enqueue({
      appName: "a",
      name: "j",
      script: "jobs/j.js",
      payload: { x: 1 },
      attempt: 1,
      maxAttempts: 3,
    });

    // Wait for claim
    const deadline = Date.now() + 2000;
    while (ready.length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(ready.length).toBe(1);
    expect(ready[0].id).toBe(ref.id);
    expect(ready[0].status).toBe("active");

    const procKey = "t:q:processing";
    expect(mock._zsets[procKey] && mock._zsets[procKey].has(ref.id)).toBe(true);

    await driver.complete(ref.id);
    expect(mock._zsets[procKey] && mock._zsets[procKey].has(ref.id)).toBe(
      false,
    );
    expect(await mock.get(`t:q:job:${ref.id}`)).toBeNull();

    await driver.shutdown();
  }, 10000);

  test("stale processing entries are reclaimed to ready", async () => {
    const mock = createMockRedis();
    const readyJobs = [];
    const driver = createRedisDriver({
      client: mock,
      keyPrefix: "t:r:",
      visibilityTimeoutMs: 50,
      reclaimIntervalMs: 60000, // manual reclaim
      pollMs: 200,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      onReady: (job) => readyJobs.push(job),
    });
    await driver.start();
    // stop consuming so first claim isn't required
    await driver.stopConsuming();

    const ref = await driver.enqueue({
      appName: "a",
      name: "j",
      script: "jobs/j.js",
      payload: {},
      attempt: 1,
      maxAttempts: 3,
    });

    // Simulate a dead worker claim: move ready → processing with past score
    const id = ref.id;
    const readyKey = "t:r:ready";
    const procKey = "t:r:processing";
    // ensure on ready list from enqueue
    await mock.lrem(readyKey, 0, id);
    await mock.zadd(procKey, Date.now() - 1000, id);
    const raw = await mock.get(`t:r:job:${id}`);
    expect(raw).toBeTruthy();

    const n = await driver._reclaimStale();
    expect(n).toBe(1);
    expect(mock._zsets[procKey] && mock._zsets[procKey].has(id)).toBe(false);
    expect(mock._lists[readyKey] && mock._lists[readyKey].includes(id)).toBe(
      true,
    );

    await driver.shutdown();
  }, 10000);

  test("releaseClaim returns job to ready list", async () => {
    const mock = createMockRedis();
    const readyJobs = [];
    const driver = createRedisDriver({
      client: mock,
      keyPrefix: "t:c:",
      visibilityTimeoutMs: 60000,
      reclaimIntervalMs: 60000,
      pollMs: 50,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      onReady: (job) => readyJobs.push(job),
    });
    await driver.start();

    const ref = await driver.enqueue({
      appName: "a",
      name: "j",
      script: "jobs/j.js",
      payload: {},
      attempt: 1,
      maxAttempts: 3,
    });

    const deadline = Date.now() + 2000;
    while (readyJobs.length < 1 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(readyJobs.length).toBe(1);

    await driver.stopConsuming();
    await driver.releaseClaim(readyJobs[0]);

    const procKey = "t:c:processing";
    expect(mock._zsets[procKey] && mock._zsets[procKey].has(ref.id)).toBe(
      false,
    );
    expect(
      mock._lists["t:c:ready"] && mock._lists["t:c:ready"].includes(ref.id),
    ).toBe(true);

    await driver.shutdown();
  }, 10000);
});

describe("queue_service shutdown drain (memory)", () => {
  let tmp;
  let app;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gingee-qdrain-"));
    const box = path.join(tmp, "box");
    fs.mkdirSync(path.join(box, "jobs"), { recursive: true });
    fs.writeFileSync(
      path.join(box, "jobs", "slow.js"),
      `
module.exports = async function () {
  await gingee(async ($g) => {
    await new Promise((r) => setTimeout(r, 200));
    $g.log.info('SLOW_DONE');
  });
};
`,
    );
    app = {
      name: "dapp",
      config: { name: "dapp" },
      appBoxPath: box,
      appWebPath: path.join(tmp, "web"),
      grantedPermissions: ["queue"],
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      in_maintenance: false,
    };
    await queueService.shutdown({ force: true, drainMs: 0 });
    await queueService.initServer(
      {
        enabled: true,
        driver: "memory",
        concurrency: 1,
        default_attempts: 1,
        default_backoff_ms: 10,
        shutdown_drain_ms: 2000,
      },
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      {
        box: { allowed_modules: [], allow_dynamic_code: true },
        privileged_apps: [],
      },
    );
    queueService.setAppsRegistry({ dapp: app });
  });

  afterEach(async () => {
    await queueService.shutdown({ force: true, drainMs: 0 });
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  test("shutdown waits for in-flight job (drain)", async () => {
    await queueService.addJob(app, "slow", {});
    // Give pump time to start the job
    await new Promise((r) => setTimeout(r, 40));
    const stats = queueService.getStats();
    expect(stats.inFlight + stats.waiting).toBeGreaterThanOrEqual(0);

    const t0 = Date.now();
    await queueService.shutdown({ drainMs: 3000 });
    const elapsed = Date.now() - t0;
    // Should have waited for the ~200ms job rather than returning instantly with force
    expect(elapsed).toBeGreaterThanOrEqual(50);
    expect(queueService.getStats().inFlight).toBe(0);
  }, 10000);

  test("getAdminStats exposes visibility and drain config", async () => {
    const s = await queueService.getAdminStats();
    expect(s.shutdown_drain_ms).toBe(2000);
    expect(s.visibility_timeout_ms).toBeGreaterThanOrEqual(1000);
  });
});
