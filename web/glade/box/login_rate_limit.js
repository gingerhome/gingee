/**
 * Glade login rate limiting (M19).
 *
 * Throttles failed login attempts using the platform cache (memory or Redis).
 * Password is set by `gingee-cli init` (not a fixed product default); rate limit
 * still matters for online guessing and Argon2 DoS.
 *
 * Config via Glade app.json env (all optional):
 *   LOGIN_MAX_ATTEMPTS  — failures before lock (default 5)
 *   LOGIN_WINDOW_SEC    — failure counter TTL (default 900)
 *   LOGIN_LOCKOUT_SEC   — lock duration (default 900)
 */

const DEFAULTS = {
  maxAttempts: 5,
  windowSec: 900,
  lockoutSec: 900,
};

/**
 * @param {object} [appEnv]
 * @returns {{ maxAttempts: number, windowSec: number, lockoutSec: number }}
 */
function resolveConfig(appEnv) {
  const env = appEnv && typeof appEnv === "object" ? appEnv : {};
  const maxAttempts = clampInt(
    env.LOGIN_MAX_ATTEMPTS,
    DEFAULTS.maxAttempts,
    1,
    100,
  );
  const windowSec = clampInt(
    env.LOGIN_WINDOW_SEC,
    DEFAULTS.windowSec,
    30,
    86400,
  );
  const lockoutSec = clampInt(
    env.LOGIN_LOCKOUT_SEC,
    DEFAULTS.lockoutSec,
    30,
    86400,
  );
  return { maxAttempts, windowSec, lockoutSec };
}

/**
 * @private
 */
function clampInt(raw, fallback, min, max) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

/**
 * Best-effort client IP for rate keys.
 * Prefers X-Forwarded-For / X-Real-IP (first hop), then socket remoteAddress.
 *
 * @param {object} request - $g.request
 * @param {object} [nodeReq] - raw IncomingMessage if available
 * @returns {string}
 */
function clientIp(request, nodeReq) {
  const headers =
    (request && request.headers) || (nodeReq && nodeReq.headers) || {};
  const xf = headers["x-forwarded-for"] || headers["X-Forwarded-For"];
  if (xf) {
    const first = String(xf).split(",")[0].trim();
    if (first) return first.slice(0, 128);
  }
  const real = headers["x-real-ip"] || headers["X-Real-IP"];
  if (real && String(real).trim()) return String(real).trim().slice(0, 128);

  const sock = (nodeReq && (nodeReq.socket || nodeReq.connection)) || null;
  if (sock && sock.remoteAddress) {
    return String(sock.remoteAddress).slice(0, 128);
  }
  return "unknown";
}

/**
 * Normalize username for rate keys (do not log raw passwords).
 * @param {string} username
 * @returns {string}
 */
function normalizeUsername(username) {
  return (
    String(username || "")
      .trim()
      .toLowerCase()
      .slice(0, 64) || "empty"
  );
}

/**
 * @private
 */
function safeKeyPart(s) {
  return String(s || "x")
    .replace(/[^a-zA-Z0-9_.:@-]/g, "_")
    .slice(0, 128);
}

/**
 * @param {string} ip
 * @returns {string}
 */
function failKeyIp(ip) {
  return `glade:login:fail:ip:${safeKeyPart(ip)}`;
}

/**
 * @param {string} user
 * @returns {string}
 */
function failKeyUser(user) {
  return `glade:login:fail:user:${safeKeyPart(user)}`;
}

/**
 * @param {string} ip
 * @returns {string}
 */
function lockKeyIp(ip) {
  return `glade:login:lock:ip:${safeKeyPart(ip)}`;
}

/**
 * @param {string} user
 * @returns {string}
 */
function lockKeyUser(user) {
  return `glade:login:lock:user:${safeKeyPart(user)}`;
}

/**
 * @param {object|null} lockVal
 * @returns {number} seconds remaining (min 1 if locked)
 */
function remainingLockSec(lockVal) {
  if (!lockVal || typeof lockVal !== "object") return 0;
  const until = Number(lockVal.until);
  if (!Number.isFinite(until)) return 0;
  const sec = Math.ceil((until - Date.now()) / 1000);
  return sec > 0 ? sec : 0;
}

/**
 * Whether login is currently allowed for this IP / username.
 *
 * @param {object} cache - cache_service-like { get }
 * @param {{ ip: string, username: string }} identity
 * @param {object} config - from resolveConfig
 * @returns {Promise<{ ok: true } | { ok: false, reason: string, retryAfterSec: number, message: string }>}
 */
async function assertLoginAllowed(cache, identity, config) {
  const ip = identity.ip || "unknown";
  const user = normalizeUsername(identity.username);

  const locks = await Promise.all([
    cache.get(lockKeyIp(ip)),
    cache.get(lockKeyUser(user)),
  ]);
  let retryAfter = 0;
  for (const lock of locks) {
    const rem = remainingLockSec(lock);
    if (rem > retryAfter) retryAfter = rem;
  }
  if (retryAfter > 0) {
    return {
      ok: false,
      reason: "LOGIN_RATE_LIMITED",
      retryAfterSec: retryAfter,
      message: `Too many failed login attempts. Try again in ${retryAfter} seconds.`,
    };
  }
  return { ok: true };
}

/**
 * Record a failed login. Locks IP and username when max attempts reached.
 *
 * @param {object} cache
 * @param {{ ip: string, username: string }} identity
 * @param {object} config
 * @returns {Promise<{ locked: boolean, attemptsIp: number, attemptsUser: number, retryAfterSec: number }>}
 */
async function recordFailure(cache, identity, config) {
  const ip = identity.ip || "unknown";
  const user = normalizeUsername(identity.username);
  const cfg = config || DEFAULTS;

  const [ipCount, userCount] = await Promise.all([
    bumpCounter(cache, failKeyIp(ip), cfg.windowSec),
    bumpCounter(cache, failKeyUser(user), cfg.windowSec),
  ]);

  let locked = false;
  let retryAfterSec = 0;
  const until = Date.now() + cfg.lockoutSec * 1000;
  const lockPayload = { until, lockedAt: new Date().toISOString() };

  if (ipCount >= cfg.maxAttempts) {
    await cache.set(lockKeyIp(ip), lockPayload, cfg.lockoutSec);
    locked = true;
    retryAfterSec = Math.max(retryAfterSec, cfg.lockoutSec);
  }
  if (userCount >= cfg.maxAttempts) {
    await cache.set(lockKeyUser(user), lockPayload, cfg.lockoutSec);
    locked = true;
    retryAfterSec = Math.max(retryAfterSec, cfg.lockoutSec);
  }

  return {
    locked,
    attemptsIp: ipCount,
    attemptsUser: userCount,
    retryAfterSec,
  };
}

/**
 * Clear failure counters and locks after successful login.
 * @param {object} cache
 * @param {{ ip: string, username: string }} identity
 */
async function clearFailures(cache, identity) {
  const ip = identity.ip || "unknown";
  const user = normalizeUsername(identity.username);
  await Promise.all([
    cache.del(failKeyIp(ip)),
    cache.del(failKeyUser(user)),
    cache.del(lockKeyIp(ip)),
    cache.del(lockKeyUser(user)),
  ]);
}

/**
 * @private
 * @param {object} cache
 * @param {string} key
 * @param {number} ttlSec
 * @returns {Promise<number>}
 */
async function bumpCounter(cache, key, ttlSec) {
  let n = 0;
  try {
    const cur = await cache.get(key);
    if (typeof cur === "number" && Number.isFinite(cur)) n = cur;
    else if (cur && typeof cur === "object" && Number.isFinite(Number(cur.n)))
      n = Number(cur.n);
    else if (cur != null && Number.isFinite(Number(cur))) n = Number(cur);
  } catch (_) {
    n = 0;
  }
  n += 1;
  // Store as plain number (JSON.stringify in cache_service)
  await cache.set(key, n, ttlSec);
  return n;
}

module.exports = {
  DEFAULTS,
  resolveConfig,
  clientIp,
  normalizeUsername,
  assertLoginAllowed,
  recordFailure,
  clearFailures,
  // test helpers
  failKeyIp,
  failKeyUser,
  lockKeyIp,
  lockKeyUser,
  remainingLockSec,
};
