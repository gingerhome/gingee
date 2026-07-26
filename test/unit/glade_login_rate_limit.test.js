/**
 * Glade login rate limit helpers (M19).
 */
const loginRateLimit = require("../../web/glade/box/login_rate_limit.js");

function memoryCache() {
  const map = new Map();
  return {
    async get(key) {
      const e = map.get(key);
      if (!e) return null;
      if (e.expiresAt && Date.now() > e.expiresAt) {
        map.delete(key);
        return null;
      }
      return e.value;
    },
    async set(key, value, ttlSec) {
      map.set(key, {
        value,
        expiresAt: ttlSec ? Date.now() + ttlSec * 1000 : null,
      });
    },
    async del(key) {
      map.delete(key);
    },
    _map: map,
  };
}

describe("glade login_rate_limit", () => {
  test("resolveConfig defaults and clamps", () => {
    expect(loginRateLimit.resolveConfig({})).toEqual(loginRateLimit.DEFAULTS);
    expect(
      loginRateLimit.resolveConfig({ LOGIN_MAX_ATTEMPTS: "10" }).maxAttempts,
    ).toBe(10);
    expect(
      loginRateLimit.resolveConfig({ LOGIN_MAX_ATTEMPTS: "0" }).maxAttempts,
    ).toBe(1);
    expect(
      loginRateLimit.resolveConfig({ LOGIN_WINDOW_SEC: "5" }).windowSec,
    ).toBe(30); // min 30
  });

  test("clientIp prefers X-Forwarded-For then socket", () => {
    expect(
      loginRateLimit.clientIp({
        headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
      }),
    ).toBe("1.2.3.4");
    expect(
      loginRateLimit.clientIp(
        { headers: {} },
        { socket: { remoteAddress: "::1" } },
      ),
    ).toBe("::1");
    expect(loginRateLimit.clientIp({ headers: {} })).toBe("unknown");
  });

  test("locks after maxAttempts failures on IP", async () => {
    const cache = memoryCache();
    const cfg = { maxAttempts: 3, windowSec: 60, lockoutSec: 120 };
    const id = { ip: "9.9.9.9", username: "admin" };

    expect((await loginRateLimit.assertLoginAllowed(cache, id, cfg)).ok).toBe(
      true,
    );

    await loginRateLimit.recordFailure(cache, id, cfg);
    await loginRateLimit.recordFailure(cache, id, cfg);
    const third = await loginRateLimit.recordFailure(cache, id, cfg);
    expect(third.locked).toBe(true);
    expect(third.retryAfterSec).toBe(120);

    const blocked = await loginRateLimit.assertLoginAllowed(cache, id, cfg);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("LOGIN_RATE_LIMITED");
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  test("username lock is independent of IP", async () => {
    const cache = memoryCache();
    const cfg = { maxAttempts: 2, windowSec: 60, lockoutSec: 60 };

    await loginRateLimit.recordFailure(
      cache,
      { ip: "1.1.1.1", username: "Admin" },
      cfg,
    );
    const second = await loginRateLimit.recordFailure(
      cache,
      { ip: "2.2.2.2", username: "admin" },
      cfg,
    );
    expect(second.locked).toBe(true);

    // Same user different IP still locked
    const blocked = await loginRateLimit.assertLoginAllowed(
      cache,
      { ip: "3.3.3.3", username: "ADMIN" },
      cfg,
    );
    expect(blocked.ok).toBe(false);
  });

  test("clearFailures allows login again", async () => {
    const cache = memoryCache();
    const cfg = { maxAttempts: 1, windowSec: 60, lockoutSec: 60 };
    const id = { ip: "8.8.8.8", username: "admin" };

    await loginRateLimit.recordFailure(cache, id, cfg);
    expect((await loginRateLimit.assertLoginAllowed(cache, id, cfg)).ok).toBe(
      false,
    );

    await loginRateLimit.clearFailures(cache, id);
    expect((await loginRateLimit.assertLoginAllowed(cache, id, cfg)).ok).toBe(
      true,
    );
  });
});
