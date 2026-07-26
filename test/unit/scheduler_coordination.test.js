const {
  normalizeCoordination,
  normalizeRedis,
  computeFireSlot,
  tickLockKey,
  leaderKey,
  RedisCoordinator,
  REDIS_DEFAULTS,
} = require("../../modules/scheduler_coordination");

describe("scheduler_coordination", () => {
  describe("normalizeCoordination (queue/cache redis pattern)", () => {
    test("defaults to driver none and strategy tick", () => {
      const c = normalizeCoordination({});
      expect(c.driver).toBe("none");
      expect(c.strategy).toBe("tick");
      expect(c.lock_ttl_ms).toBe(300000);
      expect(c.redis.key_prefix).toBe("gingee:scheduler:");
      expect(c.redis.host).toBe("127.0.0.1");
      expect(c.node_id).toBeTruthy();
    });

    test("reads coordination.driver + sibling redis (preferred)", () => {
      const c = normalizeCoordination({
        enabled: true,
        coordination: {
          driver: "redis",
          strategy: "leader",
          lock_ttl_ms: 60000,
          node_id: "node-a",
        },
        redis: { url: "redis://localhost:6379/1", key_prefix: "g:sched:" },
      });
      expect(c.driver).toBe("redis");
      expect(c.strategy).toBe("leader");
      expect(c.lock_ttl_ms).toBe(60000);
      expect(c.node_id).toBe("node-a");
      expect(c.redis.url).toBe("redis://localhost:6379/1");
      expect(c.redis.key_prefix).toBe("g:sched:");
    });

    test("legacy coordination.mode + nested coordination.redis still work", () => {
      const c = normalizeCoordination({
        coordination: {
          mode: "redis",
          strategy: "tick",
          redis: { host: "10.0.0.5", port: 6380, key_prefix: "legacy:" },
        },
      });
      expect(c.driver).toBe("redis");
      expect(c.redis.host).toBe("10.0.0.5");
      expect(c.redis.port).toBe(6380);
      expect(c.redis.key_prefix).toBe("legacy:");
    });

    test("sibling redis wins over legacy nested redis", () => {
      const c = normalizeCoordination({
        coordination: {
          driver: "redis",
          redis: { host: "old", key_prefix: "old:" },
        },
        redis: { host: "new", key_prefix: "new:" },
      });
      expect(c.redis.host).toBe("new");
      expect(c.redis.key_prefix).toBe("new:");
    });

    test("normalizeRedis matches queue field set", () => {
      const r = normalizeRedis({ url: "env:REDIS_URL", key_prefix: "x:" });
      expect(r.url).toBe("env:REDIS_URL");
      expect(r.key_prefix).toBe("x:");
      expect(r.port).toBe(REDIS_DEFAULTS.port);
    });
  });

  describe("computeFireSlot / keys", () => {
    test("buckets wall clock when no cronJob", () => {
      const g = 10000;
      const t = 1_700_000_015_000;
      const slot = computeFireSlot(null, g, t);
      expect(slot).toBe(String(Math.floor(t / g) * g));
    });

    test("prefers croner currentRun when present", () => {
      const planned = new Date("2026-07-25T12:00:00.000Z");
      const runtime = {
        cronJob: {
          currentRun: () => planned,
        },
      };
      const slot = computeFireSlot(runtime, 10000, Date.now());
      expect(slot).toBe(String(Math.floor(planned.getTime() / 10000) * 10000));
    });

    test("tick and leader key shapes", () => {
      expect(tickLockKey("p:", "app", "job", "123")).toBe("p:lock:app:job:123");
      expect(leaderKey("p:")).toBe("p:leader");
    });
  });

  describe("RedisCoordinator with mock client", () => {
    function mockRedisFactory(store) {
      return {
        status: "ready",
        on: jest.fn(),
        once: jest.fn(),
        removeListener: jest.fn(),
        set: jest.fn(async (key, val, _px, _ttl, nx) => {
          if (nx === "NX") {
            if (store[key] != null) return null;
            store[key] = val;
            return "OK";
          }
          store[key] = val;
          return "OK";
        }),
        get: jest.fn(async (key) => store[key] || null),
        pexpire: jest.fn(async () => 1),
        quit: jest.fn(async () => "OK"),
        disconnect: jest.fn(),
      };
    }

    test("tick strategy: first allow, second deny for same slot", async () => {
      const store = {};
      const client = mockRedisFactory(store);

      const coord = new RedisCoordinator(
        {
          driver: "redis",
          strategy: "tick",
          lock_ttl_ms: 60000,
          node_id: "n1",
          redis: { key_prefix: "t:" },
        },
        { info: jest.fn(), error: jest.fn() },
      );

      coord.client = client;
      coord._closed = false;

      const runtime = {
        cronJob: { currentRun: () => new Date("2026-07-25T12:00:00.000Z") },
      };

      const a = await coord.tryAllowRun({
        appName: "app",
        jobName: "nightly",
        runtime,
      });
      expect(a.allow).toBe(true);
      expect(a.reason).toBe("tick_lock");

      const b = await coord.tryAllowRun({
        appName: "app",
        jobName: "nightly",
        runtime,
      });
      expect(b.allow).toBe(false);
      expect(b.reason).toBe("tick_held");

      await coord.shutdown();
    });

    test("leader strategy: only holder allows", async () => {
      const store = {};
      const client = mockRedisFactory(store);
      const log = { info: jest.fn(), error: jest.fn() };

      const leader = new RedisCoordinator(
        {
          driver: "redis",
          strategy: "leader",
          lock_ttl_ms: 60000,
          node_id: "leader-node",
          redis: { key_prefix: "L:" },
        },
        log,
      );
      leader.client = client;

      const follower = new RedisCoordinator(
        {
          driver: "redis",
          strategy: "leader",
          lock_ttl_ms: 60000,
          node_id: "follower-node",
          redis: { key_prefix: "L:" },
        },
        log,
      );
      follower.client = client;

      const a = await leader.tryAllowRun({ appName: "a", jobName: "j" });
      expect(a.allow).toBe(true);
      expect(a.reason).toBe("leader");

      const b = await follower.tryAllowRun({ appName: "a", jobName: "j" });
      expect(b.allow).toBe(false);
      expect(b.reason).toBe("not_leader");

      await leader.shutdown();
      await follower.shutdown();
    });
  });
});
