/**
 * @module engine/isolation/resource_limits
 * @description Apply OS / V8 resource limits to isolation worker child processes.
 * Engine-internal.
 *
 * Cross-platform:
 *   - max_old_space_mb → V8 --max-old-space-size (NODE_OPTIONS)
 *   - uv_threadpool_size → UV_THREADPOOL_SIZE
 *   - priority → os.setPriority on the child (after spawn)
 *
 * Linux-only (best-effort):
 *   - max_rss_mb → prlimit RLIMIT_AS if `prlimit` is available
 *
 * Full cgroups v2 / Windows Job Objects are left to the orchestrator (Docker, systemd, etc.).
 */

const os = require("os");
const { execFile } = require("child_process");

/** Defaults when isolation.worker_limits is omitted or partial. */
const WORKER_LIMITS_DEFAULTS = {
  /** V8 old-space heap cap in MiB (null = Node default) */
  max_old_space_mb: null,
  /** V8 semi-space (young gen) in MiB (null = default) */
  max_semi_space_mb: null,
  /** libuv threadpool size (null = default 4) */
  uv_threadpool_size: null,
  /**
   * Process scheduling priority after fork.
   * "normal" | "low" | "high" | null (unchanged)
   */
  priority: null,
  /**
   * Soft RSS / address-space hint in MiB (Linux prlimit best-effort; ignored on Windows).
   * null = do not apply.
   */
  max_rss_mb: null,
};

/**
 * @param {object|null|undefined} raw
 * @returns {object}
 */
function normalizeWorkerLimits(raw) {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    max_old_space_mb: positiveOrNull(r.max_old_space_mb),
    max_semi_space_mb: positiveOrNull(r.max_semi_space_mb),
    uv_threadpool_size: positiveOrNull(r.uv_threadpool_size),
    priority: normalizePriority(r.priority),
    max_rss_mb: positiveOrNull(r.max_rss_mb),
  };
}

/**
 * @param {*} v
 * @returns {number|null}
 */
function positiveOrNull(v) {
  if (v == null || v === "" || v === false) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

/**
 * @param {*} p
 * @returns {string|null}
 */
function normalizePriority(p) {
  if (p == null || p === "") return null;
  const s = String(p).toLowerCase().trim();
  if (s === "normal" || s === "low" || s === "high") return s;
  return null;
}

/**
 * Merge NODE_OPTIONS flag list: later flags for the same key replace earlier ones.
 * @param {string} existing
 * @param {string[]} flags e.g. ['--max-old-space-size=512']
 * @returns {string}
 */
function mergeNodeOptions(existing, flags) {
  const parts = String(existing || "")
    .split(/\s+/)
    .filter(Boolean);
  const byKey = new Map();
  for (const p of parts) {
    const key = p.includes("=") ? p.split("=")[0] : p;
    byKey.set(key, p);
  }
  for (const f of flags || []) {
    if (!f) continue;
    const key = f.includes("=") ? f.split("=")[0] : f;
    byKey.set(key, f);
  }
  return [...byKey.values()].join(" ");
}

/**
 * Build env vars for a forked worker (does not mutate process.env).
 * @param {object} baseEnv - usually process.env
 * @param {object} limits - normalized worker_limits
 * @param {object} extra - GINGEE_WORKER etc.
 * @returns {object}
 */
function buildWorkerEnv(baseEnv, limits, extra) {
  const env = { ...(baseEnv || {}), ...(extra || {}) };
  const lim = normalizeWorkerLimits(limits);
  const nodeFlags = [];

  if (lim.max_old_space_mb != null) {
    nodeFlags.push(`--max-old-space-size=${lim.max_old_space_mb}`);
  }
  if (lim.max_semi_space_mb != null) {
    nodeFlags.push(`--max-semi-space-size=${lim.max_semi_space_mb}`);
  }

  if (nodeFlags.length) {
    env.NODE_OPTIONS = mergeNodeOptions(env.NODE_OPTIONS, nodeFlags);
  }

  if (lim.uv_threadpool_size != null) {
    env.UV_THREADPOOL_SIZE = String(lim.uv_threadpool_size);
  }

  // Surface applied limits for worker diagnostics
  env.GINGEE_WORKER_LIMITS = JSON.stringify({
    max_old_space_mb: lim.max_old_space_mb,
    max_semi_space_mb: lim.max_semi_space_mb,
    uv_threadpool_size: lim.uv_threadpool_size,
    priority: lim.priority,
    max_rss_mb: lim.max_rss_mb,
  });

  return env;
}

/**
 * Map priority name to os.setPriority value (cross-platform-ish).
 * @param {string} priority
 * @returns {number|null}
 */
function priorityToOsValue(priority) {
  const p = normalizePriority(priority);
  if (!p || p === "normal") return null;
  // Node docs: higher number = lower priority on Unix; Windows uses PRIORITY_CLASS constants via os.constants
  if (process.platform === "win32") {
    const c = os.constants && os.constants.priority;
    if (!c) return null;
    if (p === "low")
      return c.PRIORITY_BELOW_NORMAL != null ? c.PRIORITY_BELOW_NORMAL : 16384;
    if (p === "high")
      return c.PRIORITY_ABOVE_NORMAL != null ? c.PRIORITY_ABOVE_NORMAL : 32768;
    return null;
  }
  // Unix: 0 normal, positive nice = lower priority
  if (p === "low") return 10;
  if (p === "high") return -5;
  return null;
}

/**
 * Apply post-spawn limits (priority, Linux prlimit). Best-effort; never throws.
 * @param {object} child - child_process ChildProcess
 * @param {object} limits - normalized or raw
 * @param {object} [logger]
 * @param {string} [workerKey]
 */
function applyAfterSpawn(child, limits, logger, workerKey) {
  const lim = normalizeWorkerLimits(limits);
  const log = logger || console;
  const tag = workerKey ? `[isolation:${workerKey}]` : "[isolation]";

  if (!child || !child.pid) return;

  const pri = priorityToOsValue(lim.priority);
  if (pri != null) {
    try {
      os.setPriority(child.pid, pri);
      log.info &&
        log.info(`${tag} worker priority set to ${lim.priority} (os=${pri})`);
    } catch (e) {
      log.warn &&
        log.warn(`${tag} could not set process priority: ${e.message}`);
    }
  }

  if (lim.max_rss_mb != null) {
    applyRssLimit(child.pid, lim.max_rss_mb, log, tag);
  }
}

/**
 * Linux: prlimit --as=BYTES (address space). No-op on Windows / if prlimit missing.
 * @param {number} pid
 * @param {number} maxRssMb
 * @param {object} log
 * @param {string} tag
 */
function applyRssLimit(pid, maxRssMb, log, tag) {
  if (process.platform === "win32") {
    log.warn &&
      log.warn(
        `${tag} max_rss_mb=${maxRssMb} ignored on Windows (use Job Objects / container limits at the orchestrator). V8 max_old_space_mb still applies if set.`,
      );
    return;
  }

  const bytes = Math.floor(maxRssMb * 1024 * 1024);
  // prlimit from util-linux: --as = address space (virtual memory) ceiling
  execFile(
    "prlimit",
    [`--pid=${pid}`, `--as=${bytes}`],
    { timeout: 3000 },
    (err, _stdout, stderr) => {
      if (err) {
        log.warn &&
          log.warn(
            `${tag} max_rss_mb=${maxRssMb} not applied (prlimit: ${err.message}). Install util-linux prlimit or use cgroups/Docker.`,
          );
        if (stderr && log.warn) {
          log.warn(`${tag} prlimit stderr: ${String(stderr).trim()}`);
        }
        return;
      }
      log.info &&
        log.info(
          `${tag} applied max_rss_mb=${maxRssMb} via prlimit --as=${bytes}`,
        );
    },
  );
}

/**
 * Human-readable summary for logs.
 * @param {object} limits
 * @returns {string}
 */
function describeLimits(limits) {
  const lim = normalizeWorkerLimits(limits);
  const parts = [];
  if (lim.max_old_space_mb != null)
    parts.push(`max_old_space_mb=${lim.max_old_space_mb}`);
  if (lim.max_semi_space_mb != null)
    parts.push(`max_semi_space_mb=${lim.max_semi_space_mb}`);
  if (lim.uv_threadpool_size != null)
    parts.push(`uv_threadpool_size=${lim.uv_threadpool_size}`);
  if (lim.priority) parts.push(`priority=${lim.priority}`);
  if (lim.max_rss_mb != null) parts.push(`max_rss_mb=${lim.max_rss_mb}`);
  return parts.length ? parts.join(" ") : "none (Node defaults)";
}

module.exports = {
  WORKER_LIMITS_DEFAULTS,
  normalizeWorkerLimits,
  mergeNodeOptions,
  buildWorkerEnv,
  applyAfterSpawn,
  describeLimits,
  priorityToOsValue,
};
