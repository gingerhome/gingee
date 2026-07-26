const {
  WORKER_LIMITS_DEFAULTS,
  normalizeWorkerLimits,
  mergeNodeOptions,
  buildWorkerEnv,
  describeLimits,
  priorityToOsValue,
} = require("../../modules/engine/isolation/resource_limits");
const { ISOLATION_DEFAULTS } = require("../../modules/engine/isolation/policy");
const {
  buildDefaultConfig,
  mergeUserConfig,
} = require("../../modules/engine/config");

describe("isolation resource_limits", () => {
  test("defaults are null (no forced caps)", () => {
    expect(WORKER_LIMITS_DEFAULTS.max_old_space_mb).toBeNull();
    expect(WORKER_LIMITS_DEFAULTS.max_rss_mb).toBeNull();
    expect(ISOLATION_DEFAULTS.worker_limits).toEqual(
      expect.objectContaining({ max_old_space_mb: null }),
    );
  });

  test("normalizeWorkerLimits coerces and drops invalid", () => {
    expect(
      normalizeWorkerLimits({
        max_old_space_mb: "512",
        priority: "LOW",
        max_rss_mb: -1,
        uv_threadpool_size: 8,
      }),
    ).toEqual({
      max_old_space_mb: 512,
      max_semi_space_mb: null,
      uv_threadpool_size: 8,
      priority: "low",
      max_rss_mb: null,
    });
  });

  test("mergeNodeOptions replaces same flag", () => {
    const merged = mergeNodeOptions(
      "--max-old-space-size=256 --trace-warnings",
      ["--max-old-space-size=512"],
    );
    expect(merged).toContain("--max-old-space-size=512");
    expect(merged).not.toContain("256");
    expect(merged).toContain("--trace-warnings");
  });

  test("buildWorkerEnv sets NODE_OPTIONS and UV_THREADPOOL_SIZE", () => {
    const env = buildWorkerEnv(
      { PATH: "/bin", NODE_OPTIONS: "--trace-warnings" },
      { max_old_space_mb: 256, uv_threadpool_size: 6, priority: "low" },
      { GINGEE_WORKER: "1" },
    );
    expect(env.GINGEE_WORKER).toBe("1");
    expect(env.PATH).toBe("/bin");
    expect(env.NODE_OPTIONS).toContain("--max-old-space-size=256");
    expect(env.NODE_OPTIONS).toContain("--trace-warnings");
    expect(env.UV_THREADPOOL_SIZE).toBe("6");
    const parsed = JSON.parse(env.GINGEE_WORKER_LIMITS);
    expect(parsed.max_old_space_mb).toBe(256);
    expect(parsed.priority).toBe("low");
  });

  test("describeLimits", () => {
    expect(describeLimits({})).toMatch(/none/i);
    expect(
      describeLimits({ max_old_space_mb: 128, priority: "low" }),
    ).toContain("max_old_space_mb=128");
  });

  test("priorityToOsValue returns null for normal", () => {
    expect(priorityToOsValue("normal")).toBeNull();
    expect(priorityToOsValue(null)).toBeNull();
  });

  test("config merge deep-merges worker_limits", () => {
    const merged = mergeUserConfig(buildDefaultConfig(), {
      isolation: {
        mode: "process",
        worker_limits: { max_old_space_mb: 384, priority: "low" },
      },
    });
    expect(merged.isolation.mode).toBe("process");
    expect(merged.isolation.worker_limits.max_old_space_mb).toBe(384);
    expect(merged.isolation.worker_limits.priority).toBe("low");
    // unspecified limit keys stay as defaults (null)
    expect(merged.isolation.worker_limits.max_rss_mb).toBeNull();
  });
});
