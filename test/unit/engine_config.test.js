const {
  buildDefaultConfig,
  mergeUserConfig,
  applyHttpPortEnvOverride,
} = require("../../modules/engine/config");

describe("engine/config", () => {
  const prevPort = process.env.GINGEE_HTTP_PORT;

  afterEach(() => {
    if (prevPort === undefined) delete process.env.GINGEE_HTTP_PORT;
    else process.env.GINGEE_HTTP_PORT = prevPort;
  });

  test("buildDefaultConfig includes core control sections", () => {
    const d = buildDefaultConfig();
    expect(d.server.http.port).toBe(7070);
    expect(d.scheduler.enabled).toBe(false);
    expect(d.scheduler.coordination.driver).toBe("none");
    expect(d.scheduler.coordination.strategy).toBe("tick");
    expect(d.scheduler.redis.key_prefix).toBe("gingee:scheduler:");
    expect(d.metrics.allow_from).toEqual(expect.arrayContaining(["127.0.0.1"]));
    expect(d.privileged_apps).toContain("glade");
    expect(d.box.local_modules).toEqual([]);
    expect(d.jwt).toEqual({ secret: null, iss: null });
  });

  test("mergeUserConfig deep-merges websockets.fanout and websockets.redis", () => {
    const merged = mergeUserConfig(buildDefaultConfig(), {
      websockets: {
        fanout: { driver: "redis" },
        redis: { url: "redis://127.0.0.1:6379", key_prefix: "g:ws:" },
      },
    });
    expect(merged.websockets.fanout.driver).toBe("redis");
    expect(merged.websockets.redis.url).toBe("redis://127.0.0.1:6379");
    expect(merged.websockets.redis.key_prefix).toBe("g:ws:");
    expect(merged.websockets.enabled).toBe(true);
  });

  test("mergeUserConfig deep-merges scheduler.redis sibling (queue/cache pattern)", () => {
    const merged = mergeUserConfig(buildDefaultConfig(), {
      scheduler: {
        enabled: true,
        coordination: {
          driver: "redis",
        },
        redis: { url: "redis://127.0.0.1:6379", key_prefix: "g:s:" },
      },
    });
    expect(merged.scheduler.enabled).toBe(true);
    expect(merged.scheduler.coordination.driver).toBe("redis");
    expect(merged.scheduler.coordination.strategy).toBe("tick");
    expect(merged.scheduler.redis.url).toBe("redis://127.0.0.1:6379");
    expect(merged.scheduler.redis.key_prefix).toBe("g:s:");
    expect(merged.scheduler.redis.port).toBe(6379);
  });

  test("mergeUserConfig deep-merges server and egress lists from user", () => {
    const merged = mergeUserConfig(buildDefaultConfig(), {
      server: { http: { port: 8080 } },
      egress: { mode: "allowlist", allow_hosts: ["api.example.com"] },
      logging: { level: "info", rotation: { max_size_mb: 10 } },
    });
    expect(merged.server.http.port).toBe(8080);
    // Shallow server merge (legacy behavior): user http object replaces defaults' http keys.
    expect(merged.egress.mode).toBe("allowlist");
    expect(merged.egress.allow_hosts).toEqual(["api.example.com"]);
    expect(merged.logging.level).toBe("info");
    expect(merged.logging.rotation.max_size_mb).toBe(10);
    expect(merged.logging.rotation.period_days).toBe(7);
  });

  test("applyHttpPortEnvOverride sets http port when GINGEE_HTTP_PORT is set", () => {
    process.env.GINGEE_HTTP_PORT = "9099";
    const config = buildDefaultConfig();
    applyHttpPortEnvOverride(config);
    expect(config.server.http.port).toBe(9099);
    expect(config.server.http.enabled).toBe(true);
  });
});
