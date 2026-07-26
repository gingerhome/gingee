/**
 * Atomic DLQ discard / retry (Redis Lua + memory claim-before-await).
 */
const { createRedisDriver } = require("../../modules/queue_drivers/redis");
const { createMemoryDriver } = require("../../modules/queue_drivers/memory");

/** Shared minimal mock from visibility tests — reimplemented for isolation. */
function createMockRedis() {
  const lists = {};
  const zsets = {};
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
    async brpop() {
      return null;
    },
    async lpush(key, id) {
      list(key).unshift(String(id));
      return list(key).length;
    },
    async lrem(key, _c, id) {
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
      return list(key).slice(start, stop + 1);
    },
    async llen(key) {
      return list(key).length;
    },
    async ltrim() {
      return "OK";
    },
    async zadd(key, score, id) {
      zset(key).set(String(id), Number(score));
      return 1;
    },
    async zrem(key, id) {
      return zset(key).delete(String(id)) ? 1 : 0;
    },
    async zscore() {
      return null;
    },
    async zcard(key) {
      return zset(key).size;
    },
    async zrangebyscore() {
      return [];
    },
    async get(key) {
      return kv[key] != null ? kv[key] : null;
    },
    async set(key, val) {
      kv[key] = String(val);
      return "OK";
    },
    async del(key) {
      const had = kv[key] != null;
      delete kv[key];
      return had ? 1 : 0;
    },
    async eval(script, numKeys, ...keysAndArgs) {
      const keys = keysAndArgs.slice(0, numKeys);
      const args = keysAndArgs.slice(numKeys);
      const s = String(script);
      if (s.includes("cjson") || s.includes("job['status']")) {
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
        await client.set(jobK, JSON.stringify(job));
        await client.lpush(readyK, id);
        return JSON.stringify(job);
      }
      // discard
      const [dlqK, jobK, procK] = keys;
      const id = String(args[0]);
      const n = await client.lrem(dlqK, 0, id);
      if (n > 0) {
        await client.del(jobK);
        await client.zrem(procK, id);
        return 1;
      }
      return 0;
    },
    async quit() {
      return "OK";
    },
    disconnect() {},
    _kv: kv,
    _lists: lists,
    _zsets: zsets,
  };
  const origSet = client.set.bind(client);
  client.set = async (key, val) => origSet(key, val);
  return client;
}

describe("redis atomic DLQ", () => {
  let mock;
  let driver;
  const prefix = "t:dlq:";

  beforeEach(async () => {
    mock = createMockRedis();
    driver = createRedisDriver({
      client: mock,
      keyPrefix: prefix,
      visibilityTimeoutMs: 60000,
      reclaimIntervalMs: 60000,
      pollMs: 200,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      onReady: () => {},
    });
    await driver.start();
    await driver.stopConsuming();
  });

  afterEach(async () => {
    await driver.shutdown();
  });

  async function seedFailedJob(id, extra = {}) {
    const job = {
      id,
      appName: "a",
      name: "j",
      script: "jobs/j.js",
      payload: { n: 1 },
      attempt: 3,
      maxAttempts: 3,
      status: "failed",
      error: "boom",
      failedAt: Date.now(),
      ...extra,
    };
    await mock.set(`${prefix}job:${id}`, JSON.stringify(job));
    await mock.lpush(`${prefix}dlq`, id);
    return job;
  }

  test("discardDlq only deletes hash when id is on DLQ", async () => {
    const liveId = "live-1";
    // Live waiting job hash (NOT on DLQ)
    await mock.set(
      `${prefix}job:${liveId}`,
      JSON.stringify({
        id: liveId,
        status: "waiting",
        name: "x",
        appName: "a",
      }),
    );
    await mock.lpush(`${prefix}ready`, liveId);

    const ok = await driver.discardDlq(liveId);
    expect(ok).toBe(false);
    // Live job hash must survive
    expect(await mock.get(`${prefix}job:${liveId}`)).toBeTruthy();

    await seedFailedJob("dead-1");
    const ok2 = await driver.discardDlq("dead-1");
    expect(ok2).toBe(true);
    expect(await mock.get(`${prefix}job:dead-1`)).toBeNull();
    expect(mock._lists[`${prefix}dlq`] || []).not.toContain("dead-1");
  });

  test("retryDlq is single-winner under concurrent claims", async () => {
    await seedFailedJob("retry-1");

    const [a, b, c] = await Promise.all([
      driver.retryDlq("retry-1", { maxAttempts: 5 }),
      driver.retryDlq("retry-1", { maxAttempts: 5 }),
      driver.retryDlq("retry-1", { maxAttempts: 5 }),
    ]);
    const wins = [a, b, c].filter(Boolean);
    expect(wins.length).toBe(1);
    expect(wins[0].id).toBe("retry-1");

    // On ready once
    const ready = mock._lists[`${prefix}ready`] || [];
    expect(ready.filter((x) => x === "retry-1").length).toBe(1);
    // Not on DLQ
    expect((mock._lists[`${prefix}dlq`] || []).includes("retry-1")).toBe(false);

    const raw = await mock.get(`${prefix}job:retry-1`);
    const j = JSON.parse(raw);
    expect(j.status).toBe("waiting");
    expect(j.attempt).toBe(1);
    expect(j.maxAttempts).toBe(5);
  });

  test("retryDlq refuses non-failed job that is not on DLQ status", async () => {
    // On DLQ list but status is waiting (corrupt) — script puts back
    const id = "bad-status";
    await mock.set(
      `${prefix}job:${id}`,
      JSON.stringify({
        id,
        appName: "a",
        name: "j",
        status: "waiting",
        attempt: 1,
        maxAttempts: 3,
      }),
    );
    await mock.lpush(`${prefix}dlq`, id);
    const r = await driver.retryDlq(id, { maxAttempts: 3 });
    expect(r).toBeNull();
    // Put back on DLQ
    expect((mock._lists[`${prefix}dlq`] || []).includes(id)).toBe(true);
  });
});

describe("memory atomic DLQ", () => {
  test("concurrent retryDlq only one wins", async () => {
    const ready = [];
    const driver = createMemoryDriver({
      onReady: (j) => ready.push(j),
      logger: console,
    });
    await driver.start();
    await driver.enqueue({
      id: "m1",
      appName: "a",
      name: "j",
      script: "jobs/j.js",
      payload: {},
      attempt: 1,
      maxAttempts: 1,
    });
    // Force to DLQ
    await driver.deadLetter(
      {
        id: "m1",
        appName: "a",
        name: "j",
        script: "jobs/j.js",
        payload: {},
        attempt: 1,
        maxAttempts: 1,
      },
      new Error("fail"),
    );

    const results = await Promise.all([
      driver.retryDlq("m1", { maxAttempts: 3 }),
      driver.retryDlq("m1", { maxAttempts: 3 }),
      driver.retryDlq("m1", { maxAttempts: 3 }),
    ]);
    expect(results.filter(Boolean).length).toBe(1);
    expect(await driver.getDlqJob("m1")).toBeNull();
    await driver.shutdown();
  });

  test("discard of missing id is false; discard succeeds once", async () => {
    const driver = createMemoryDriver({ onReady: () => {}, logger: console });
    await driver.start();
    await driver.deadLetter(
      {
        id: "d1",
        appName: "a",
        name: "j",
        script: "j.js",
        payload: null,
        attempt: 2,
        maxAttempts: 2,
      },
      "x",
    );
    expect(await driver.discardDlq("d1")).toBe(true);
    expect(await driver.discardDlq("d1")).toBe(false);
    await driver.shutdown();
  });
});
