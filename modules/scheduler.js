const path = require("path");
const fs = require("fs");
const { Cron } = require("croner");
const axios = require("axios");
const { als } = require("./gingee.js");
const { runInGBox, resolveAllowDynamicCodeForApp } = require("./gbox.js");
const { isPathInside } = require("./internal_utils.js");
const egress = require("./egress.js");
const {
  normalizeCoordination,
  COORDINATION_DEFAULTS,
  RedisCoordinator,
} = require("./scheduler_coordination.js");

const engineRoot = path.resolve(__dirname, "..");

/**
 * @module scheduler
 * @description
 * Time-based job runner for Gingee apps (declarative schedules in `app.json`).
 *
 * <b>Server gate:</b> `gingee.json` → `scheduler.enabled` (default <code>false</code>).
 *
 * <b>Multi-node:</b> set <code>scheduler.coordination.driver: "redis"</code> and configure
 * sibling <code>scheduler.redis</code> (same shape as queue.redis / cache.redis) so only one
 * node runs each occurrence (tick locks) or only the elected leader runs jobs
 * (strategy <code>leader</code>). Without coordination, enable the scheduler on at most one
 * node for script/url targets (or use queue targets with redis queue).
 *
 * <b>App config:</b> `app.json` → `schedules` array. Each job needs a unique `name`, a
 * `cron` expression, and a `target` of type <code>script</code>, <code>url</code>, or
 * <code>queue</code>.
 *
 * <b>Permissions:</b> App must be granted <code>scheduler</code> to register any jobs.
 * URL targets also require <code>httpclient</code>; queue targets also require <code>queue</code>.
 *
 * <b>Defaults:</b> overlap = skip, misfire = skip, timezone from job or server default (UTC).
 *
 * This module is engine-internal (not for sandboxed app <code>require</code> in v1).
 */

/** @type {{ enabled: boolean, timezone: string, coordination: object }} */
let serverConfig = {
  enabled: false,
  timezone: "UTC",
  coordination: normalizeCoordination(COORDINATION_DEFAULTS),
};

/** @type {object|null} */
let serverLogger = null;

/** @type {object|null} */
let globalConfigRef = null;

/** RedisCoordinator instance or null */
/** @type {object|null} */
let coordinator = null;

/**
 * appName → Map(jobName → jobRuntime)
 * @type {Map<string, Map<string, object>>}
 */
const appJobs = new Map();

/**
 * @private
 */
function log() {
  return serverLogger || console;
}

/**
 * @private
 */
function granted(app) {
  return (app && app.grantedPermissions) || [];
}

/**
 * Validate and normalize one schedule definition from app.json.
 * @param {object} raw
 * @param {string} appName
 * @returns {{ ok: true, job: object } | { ok: false, error: string }}
 * @private
 */
function normalizeSchedule(raw, appName) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Schedule entry must be an object." };
  }

  const name = raw.name != null ? String(raw.name).trim() : "";
  if (!name) {
    return { ok: false, error: 'Schedule is missing required "name".' };
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) {
    return {
      ok: false,
      error: `Schedule name '${name}' is invalid (use letters, digits, . _ -).`,
    };
  }

  const cron = raw.cron != null ? String(raw.cron).trim() : "";
  if (!cron) {
    return {
      ok: false,
      error: `Schedule '${name}' is missing required "cron".`,
    };
  }

  try {
    // Validate pattern without starting a job.
    // eslint-disable-next-line no-new
    new Cron(cron, { paused: true });
  } catch (e) {
    return {
      ok: false,
      error: `Schedule '${name}' has invalid cron '${cron}': ${e.message}`,
    };
  }

  const target = raw.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return {
      ok: false,
      error: `Schedule '${name}' is missing required "target" object.`,
    };
  }

  const type = target.type != null ? String(target.type).toLowerCase() : "";
  if (type !== "script" && type !== "url" && type !== "queue") {
    return {
      ok: false,
      error: `Schedule '${name}' target.type must be "script", "url", or "queue".`,
    };
  }

  const normalizedTarget = { type };

  if (type === "script") {
    const scriptPath = target.path != null ? String(target.path).trim() : "";
    if (!scriptPath) {
      return {
        ok: false,
        error: `Schedule '${name}' script target needs "path".`,
      };
    }
    if (path.isAbsolute(scriptPath) || scriptPath.includes("\0")) {
      return {
        ok: false,
        error: `Schedule '${name}' script path must be relative to box/ (not absolute).`,
      };
    }
    const virtualRoot = path.resolve("/__gingee_box__");
    const resolved = path.resolve(virtualRoot, scriptPath);
    if (!isPathInside(resolved, virtualRoot)) {
      return {
        ok: false,
        error: `Schedule '${name}' script path escapes the app box: '${scriptPath}'.`,
      };
    }
    normalizedTarget.path = scriptPath.replace(/\\/g, "/");
  } else if (type === "queue") {
    // Enqueue a background job (multi-node safe when queue.driver is redis).
    const jobName =
      (target.job != null && String(target.job).trim()) ||
      (target.name != null && String(target.name).trim()) ||
      "";
    if (!jobName) {
      return {
        ok: false,
        error: `Schedule '${name}' queue target needs "job" (queue job name).`,
      };
    }
    normalizedTarget.job = jobName;
    if (target.script != null) {
      normalizedTarget.script = String(target.script).trim();
    }
    if (Object.prototype.hasOwnProperty.call(target, "payload")) {
      normalizedTarget.payload = target.payload;
    }
    if (target.delayMs != null) {
      normalizedTarget.delayMs = Number(target.delayMs) || 0;
    }
  } else {
    const url = target.url != null ? String(target.url).trim() : "";
    if (!url) {
      return { ok: false, error: `Schedule '${name}' url target needs "url".` };
    }
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      return {
        ok: false,
        error: `Schedule '${name}' has invalid absolute URL.`,
      };
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        ok: false,
        error: `Schedule '${name}' URL must be http: or https:.`,
      };
    }
    normalizedTarget.url = url;
    normalizedTarget.method = (target.method || "GET").toString().toUpperCase();
    if (
      !["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].includes(
        normalizedTarget.method,
      )
    ) {
      return {
        ok: false,
        error: `Schedule '${name}' has unsupported HTTP method '${normalizedTarget.method}'.`,
      };
    }
    normalizedTarget.headers =
      target.headers &&
      typeof target.headers === "object" &&
      !Array.isArray(target.headers)
        ? { ...target.headers }
        : {};
    if (Object.prototype.hasOwnProperty.call(target, "body")) {
      normalizedTarget.body = target.body;
    }
  }

  const timezone =
    (raw.timezone && String(raw.timezone).trim()) ||
    serverConfig.timezone ||
    "UTC";

  let timeout_ms;
  if (raw.timeout_ms != null) {
    timeout_ms = Number(raw.timeout_ms);
    if (!Number.isFinite(timeout_ms) || timeout_ms < 1000) {
      return {
        ok: false,
        error: `Schedule '${name}' timeout_ms must be a number >= 1000.`,
      };
    }
  } else {
    timeout_ms = type === "url" ? 60000 : type === "queue" ? 30000 : 300000;
  }

  const overlap =
    raw.overlap != null ? String(raw.overlap).toLowerCase() : "skip";
  if (overlap !== "skip") {
    return {
      ok: false,
      error: `Schedule '${name}': only overlap "skip" is supported in v1.`,
    };
  }

  return {
    ok: true,
    job: {
      name,
      cron,
      timezone,
      enabled: raw.enabled !== false,
      overlap,
      timeout_ms,
      payload: raw.payload !== undefined ? raw.payload : null,
      target: normalizedTarget,
      appName,
    },
  };
}

/**
 * @private
 */
async function executeScriptJob(app, job, runMeta) {
  const fullScriptPath = path.resolve(app.appBoxPath, job.target.path);
  if (!isPathInside(fullScriptPath, app.appBoxPath)) {
    throw new Error(`Script path escapes box: ${job.target.path}`);
  }
  if (!fs.existsSync(fullScriptPath)) {
    throw new Error(`Scheduled script not found: ${job.target.path}`);
  }

  const gBoxConfig = {
    appName: app.name,
    app,
    appBoxPath: app.appBoxPath,
    globalModulesPath: path.join(engineRoot, "modules"),
    localModulesPaths:
      (globalConfigRef &&
        globalConfigRef.box &&
        globalConfigRef.box.localModulesPaths) ||
      [],
    allowedBuiltinModules:
      (globalConfigRef &&
        globalConfigRef.box &&
        globalConfigRef.box.allowed_modules) ||
      [],
    privilegedApps: (globalConfigRef && globalConfigRef.privileged_apps) || [],
    useCache: true,
    logger: app.logger || log(),
    globalConfig: globalConfigRef,
    allowDynamicCode: resolveAllowDynamicCodeForApp(
      globalConfigRef && globalConfigRef.box,
      app && app.config,
    ),
  };

  const scheduleMeta = {
    name: job.name,
    cron: job.cron,
    timezone: job.timezone,
    runId: runMeta.runId,
    scheduledAt: runMeta.scheduledAt,
    attempt: 1,
    targetType: "script",
    path: job.target.path,
  };

  const signal = runMeta && runMeta.signal;
  const abortController = runMeta && runMeta.abortController;

  await als.run(
    {
      appName: app.name,
      app,
      logger: app.logger || log(),
      globalConfig: globalConfigRef,
      scriptPath: fullScriptPath,
      scriptFolder: path.dirname(fullScriptPath),
      isSchedule: true,
      scheduleMeta,
      schedulePayload: job.payload !== undefined ? job.payload : null,
      // Cooperative cancel for schedule timeout (M5) — httpclient respects requestAbortSignal.
      requestAbortSignal: signal || null,
      requestAbortController: abortController || null,
      requestDeadline:
        job.timeout_ms != null ? Date.now() + Number(job.timeout_ms) : null,
      requestStartedAt: Date.now(),
    },
    async () => {
      if (signal && signal.aborted) {
        throw new Error(`Schedule job '${job.name}' aborted before start`);
      }
      const scriptModule = runInGBox(fullScriptPath, gBoxConfig);
      if (typeof scriptModule !== "function") {
        throw new Error(
          `Scheduled script ${job.target.path} did not export a function.`,
        );
      }
      await scriptModule();
    },
  );
}

/**
 * @private
 */
/**
 * Enqueue a queue job from a CRON schedule (preferred multi-node pattern).
 * @private
 */
async function executeQueueJob(app, job, runMeta) {
  const perms = granted(app);
  if (!perms.includes("queue")) {
    throw new Error(
      `Schedule '${job.name}' queue target requires the "queue" permission for app '${app.name}'.`,
    );
  }
  const queueService = require("./engine/queue_service.js");
  if (!queueService.isEnabled()) {
    throw new Error(
      `Schedule '${job.name}' cannot enqueue: server queue is disabled (queue.enabled).`,
    );
  }
  const jobName = job.target.job;
  const payload =
    job.target.payload !== undefined
      ? job.target.payload
      : job.payload !== undefined
        ? job.payload
        : {
            schedule: job.name,
            runId: runMeta && runMeta.runId,
            scheduledAt: runMeta && runMeta.scheduledAt,
          };
  const result = await queueService.addJob(app, jobName, payload, {
    script: job.target.script,
    delayMs: job.target.delayMs || 0,
  });
  const logger = app.logger || log();
  logger.info(
    `[scheduler] Queue job '${job.name}' enqueued queue job '${jobName}' id=${result.id}`,
  );
  return result;
}

async function executeUrlJob(app, job, runMeta) {
  const perms = granted(app);
  if (!perms.includes("httpclient")) {
    throw new Error(
      `Schedule '${job.name}' URL target requires the "httpclient" permission for app '${app.name}'.`,
    );
  }

  const signal = runMeta && runMeta.signal;
  if (signal && signal.aborted) {
    throw new Error(`Schedule job '${job.name}' aborted before URL fetch`);
  }

  const allowed = await egress.assertUrlAllowed(job.target.url);
  if (!allowed.ok) {
    throw new Error(
      `Schedule '${job.name}' egress denied (${allowed.reason}): ${allowed.message}`,
    );
  }

  const method = job.target.method || "GET";
  const headers = { ...(job.target.headers || {}) };
  const config = {
    method,
    url: job.target.url,
    headers,
    timeout: job.timeout_ms,
    validateStatus: () => true,
    maxRedirects: egress.getMaxRedirects(),
    beforeRedirect: egress.beforeRedirect,
    responseType: "text",
    transitional: { clarifyTimeoutError: true },
    // M5: abort in-flight axios when schedule times out.
    ...(signal ? { signal } : {}),
  };
  // Pin TCP connect to policy-validated addresses (H13).
  egress.applyConnectPin(config, allowed);

  if (job.target.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (
      typeof job.target.body === "object" &&
      job.target.body !== null &&
      !Buffer.isBuffer(job.target.body)
    ) {
      if (!headers["Content-Type"] && !headers["content-type"]) {
        headers["Content-Type"] = "application/json";
      }
      config.data = job.target.body;
    } else {
      config.data = job.target.body;
    }
  }

  const response = await axios(config);
  const logger = app.logger || log();
  logger.info(
    `[scheduler] URL job '${job.name}' → ${job.target.url} status=${response.status}`,
  );
  if (response.status >= 400) {
    throw new Error(
      `URL job '${job.name}' returned HTTP ${response.status} from ${job.target.url}`,
    );
  }
  return { status: response.status };
}

/**
 * @private
 * @param {string} appName
 * @param {string} status
 */
function incRunMetric(appName, status) {
  try {
    const metrics = require("./metrics.js");
    metrics.inc("gingee_scheduler_job_runs_total", {
      app: appName,
      status,
    });
  } catch (_) {
    /* metrics optional */
  }
}

/**
 * Run a single job once (shared by CRON tick and tests).
 * @param {object} app
 * @param {object} runtime
 * @param {object} [opts] - force: true skips multi-node coordination (admin / tests)
 * @private
 */
async function runJob(app, runtime, opts) {
  const force = opts && opts.force === true;
  const job = runtime.def;
  const logger = app.logger || log();

  if (app.in_maintenance) {
    logger.warn(
      `[scheduler] Skipping job '${job.name}' for app '${app.name}': app is in maintenance.`,
    );
    runtime.lastStatus = "skipped_maintenance";
    runtime.lastError = null;
    incRunMetric(app.name, "skipped_maintenance");
    return;
  }

  if (runtime.running) {
    logger.warn(
      `[scheduler] Skipping job '${job.name}' for app '${app.name}': previous run still in progress (overlap=skip).`,
    );
    runtime.lastStatus = "skipped_overlap";
    incRunMetric(app.name, "skipped_overlap");
    return;
  }

  // Multi-node coordination (Redis tick lock or global leader). Fail-closed on Redis errors.
  if (!force && coordinator && coordinator.enabled()) {
    const decision = await coordinator.tryAllowRun({
      appName: app.name,
      jobName: job.name,
      runtime,
    });
    if (!decision.allow) {
      const status =
        decision.reason === "redis_error"
          ? "skipped_coord_error"
          : decision.reason === "not_leader"
            ? "skipped_not_leader"
            : "skipped_coordination";
      runtime.lastStatus = status;
      runtime.lastError =
        decision.reason === "redis_error"
          ? decision.detail || "redis error"
          : null;
      if (decision.reason === "redis_error") {
        logger.error(
          `[scheduler] Skipping job '${job.name}' for app '${app.name}': coordination Redis error (${decision.detail || "unknown"}). Fail-closed.`,
        );
      } else {
        logger.info(
          `[scheduler] Skipping job '${job.name}' for app '${app.name}': another node holds the schedule (${decision.reason}).`,
        );
      }
      incRunMetric(app.name, status);
      return;
    }
  }

  const scheduledAt = new Date().toISOString();
  const runId = `${app.name}:${job.name}:${Date.now()}`;
  runtime.running = true;
  runtime.lastStartedAt = scheduledAt;
  runtime.lastError = null;

  let timeoutHandle = null;
  let timedOut = false;
  // M5: abort cooperative work (URL axios / script httpclient) on timeout.
  const abortController = new AbortController();
  runtime.abortController = abortController;

  const runMeta = {
    runId,
    scheduledAt,
    signal: abortController.signal,
    abortController,
  };

  const work = (async () => {
    if (job.target.type === "script") {
      await executeScriptJob(app, job, runMeta);
    } else if (job.target.type === "queue") {
      await executeQueueJob(app, job, runMeta);
    } else {
      await executeUrlJob(app, job, runMeta);
    }
  })();

  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        if (!abortController.signal.aborted) {
          abortController.abort(
            new Error(
              `Schedule job '${job.name}' timed out after ${job.timeout_ms}ms`,
            ),
          );
        }
      } catch (_) {
        try {
          abortController.abort();
        } catch (__) {
          /* ignore */
        }
      }
      reject(
        new Error(
          `Schedule job '${job.name}' timed out after ${job.timeout_ms}ms`,
        ),
      );
    }, job.timeout_ms);
  });

  try {
    await Promise.race([work, timeoutPromise]);
    // If abort won a race with a still-resolving work promise, prefer timeout status.
    if (timedOut || abortController.signal.aborted) {
      runtime.lastStatus = "timeout";
      runtime.lastError = `Schedule job '${job.name}' timed out after ${job.timeout_ms}ms`;
      runtime.lastFinishedAt = new Date().toISOString();
      logger.error(
        `[scheduler] Job '${job.name}' for app '${app.name}' failed: ${runtime.lastError}`,
      );
    } else {
      runtime.lastStatus = "ok";
      runtime.lastFinishedAt = new Date().toISOString();
      logger.info(
        `[scheduler] Job '${job.name}' for app '${app.name}' completed successfully.`,
      );
    }
  } catch (err) {
    runtime.lastStatus =
      timedOut || abortController.signal.aborted ? "timeout" : "error";
    runtime.lastError = err.message || String(err);
    runtime.lastFinishedAt = new Date().toISOString();
    logger.error(
      `[scheduler] Job '${job.name}' for app '${app.name}' failed: ${runtime.lastError}`,
    );
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    incRunMetric(app.name, runtime.lastStatus || "unknown");
  }

  // Wait for underlying work to settle so overlap protection stays accurate.
  // Abort should make URL/httpclient stop promptly; scripts still cooperate via signal.
  try {
    await work;
  } catch (_) {
    /* already logged if this was the race winner */
  }
  runtime.running = false;
  runtime.abortController = null;
}

/**
 * Register CRON for one normalized job definition.
 * @private
 */
function startCronWithApp(app, job) {
  const logger = app.logger || log();
  const runtime = {
    app,
    def: job,
    running: false,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastStatus: null,
    lastError: null,
    cronJob: null,
  };

  const cronJob = new Cron(
    job.cron,
    {
      timezone: job.timezone,
      protect: true,
      name: `gingee:${app.name}:${job.name}`,
    },
    () => {
      runJob(app, runtime).catch((err) => {
        logger.error(
          `[scheduler] Unhandled error in job '${job.name}' (${app.name}): ${err.message}`,
        );
      });
    },
  );

  runtime.cronJob = cronJob;

  let appMap = appJobs.get(app.name);
  if (!appMap) {
    appMap = new Map();
    appJobs.set(app.name, appMap);
  }
  appMap.set(job.name, runtime);

  const next = cronJob.nextRun();
  logger.info(
    `[scheduler] Registered job '${job.name}' for app '${app.name}' cron='${job.cron}' tz='${job.timezone}' next=${next ? next.toISOString() : "n/a"}`,
  );
}

/**
 * Initialize server-level scheduler settings.
 * @param {object|null|undefined} config - from gingee.json → scheduler
 * @param {object} logger
 * @param {object} globalConfig - full server config (for box/privileged apps)
 */
function initServer(config, logger, globalConfig) {
  serverLogger = logger || console;
  globalConfigRef = globalConfig || null;
  const c =
    config && typeof config === "object" && !Array.isArray(config)
      ? config
      : {};
  // Full scheduler section: coordination.driver + sibling redis (queue/cache pattern)
  const coordination = normalizeCoordination(c);
  serverConfig = {
    enabled: c.enabled === true,
    timezone: (c.timezone && String(c.timezone).trim()) || "UTC",
    coordination: {
      driver: coordination.driver,
      strategy: coordination.strategy,
      lock_ttl_ms: coordination.lock_ttl_ms,
      slot_granularity_ms: coordination.slot_granularity_ms,
      node_id: coordination.node_id,
    },
    redis: { ...coordination.redis },
  };

  // Tear down previous coordinator (tests / re-init)
  if (coordinator) {
    coordinator.shutdown().catch(() => {});
    coordinator = null;
  }
  if (coordination.driver === "redis") {
    coordinator = new RedisCoordinator(coordination, log());
  }

  if (serverConfig.enabled) {
    const coordMsg =
      coordination.driver === "redis"
        ? ` coordination.driver=redis strategy=${coordination.strategy} node=${coordination.node_id} prefix=${coordination.redis.key_prefix}`
        : " coordination.driver=none (enable on at most one node for script/url multi-server)";
    log().info(
      `[scheduler] Enabled (default timezone: ${serverConfig.timezone}).${coordMsg} Jobs will register from app.json schedules.`,
    );
  } else {
    log().info(
      "[scheduler] Disabled (scheduler.enabled is false). No CRON jobs will run on this node.",
    );
  }
}

/**
 * Register schedules for one app from app.config.schedules.
 * No-op if server scheduler is disabled or app has no schedules.
 * @param {object} app
 */
async function registerApp(app) {
  if (!serverConfig.enabled) return;
  if (!app || !app.name) return;

  unregisterApp(app.name);

  const schedules = app.config && app.config.schedules;
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return;
  }

  const perms = granted(app);
  if (!perms.includes("scheduler")) {
    log().error(
      `[scheduler] App '${app.name}' declares schedules but is not granted the "scheduler" permission. Jobs not registered.`,
    );
    return;
  }

  const seen = new Set();
  for (const raw of schedules) {
    const result = normalizeSchedule(raw, app.name);
    if (!result.ok) {
      log().error(`[scheduler] App '${app.name}': ${result.error}`);
      continue;
    }
    const job = result.job;
    if (seen.has(job.name)) {
      log().error(
        `[scheduler] App '${app.name}': duplicate schedule name '${job.name}' — skipping.`,
      );
      continue;
    }
    seen.add(job.name);

    if (!job.enabled) {
      log().info(
        `[scheduler] App '${app.name}' job '${job.name}' is disabled — not registered.`,
      );
      continue;
    }

    if (job.target.type === "queue" && !perms.includes("queue")) {
      log().error(
        `[scheduler] App '${app.name}' job '${job.name}' is a queue target but "queue" is not granted — skipping.`,
      );
      continue;
    }

    if (job.target.type === "url" && !perms.includes("httpclient")) {
      log().error(
        `[scheduler] App '${app.name}' job '${job.name}' is a URL target but "httpclient" is not granted — skipping.`,
      );
      continue;
    }

    if (job.target.type === "url") {
      // Full egress check (incl. DNS) at register; re-checked again at fire time.
      const eg = await egress.assertUrlAllowed(job.target.url);
      if (!eg.ok) {
        log().error(
          `[scheduler] App '${app.name}' job '${job.name}' URL blocked by egress (${eg.reason}): ${eg.message}`,
        );
        continue;
      }
    }

    try {
      startCronWithApp(app, job);
    } catch (e) {
      log().error(
        `[scheduler] Failed to start job '${job.name}' for app '${app.name}': ${e.message}`,
      );
    }
  }
}

/**
 * Stop and remove all jobs for an app.
 * @param {string} appName
 */
function unregisterApp(appName) {
  const appMap = appJobs.get(appName);
  if (!appMap) return;
  for (const runtime of appMap.values()) {
    try {
      if (runtime.cronJob) runtime.cronJob.stop();
    } catch (_) {
      /* ignore */
    }
  }
  appJobs.delete(appName);
  log().info(`[scheduler] Unregistered all jobs for app '${appName}'.`);
}

/**
 * Re-read app schedules after reload.
 * @param {string} appName
 * @param {object} app
 */
async function reinitApp(appName, app) {
  unregisterApp(appName);
  if (app) await registerApp(app);
}

/**
 * Stop all scheduled jobs (server shutdown).
 */
function shutdown() {
  for (const appName of [...appJobs.keys()]) {
    unregisterApp(appName);
  }
  if (coordinator) {
    coordinator.shutdown().catch(() => {});
    coordinator = null;
  }
  log().info("[scheduler] Shutdown complete.");
}

/**
 * List registered jobs (tests / Glade admin UI).
 * @param {object} [opts]
 * @param {string} [opts.appName] - filter by app (substring match if filterPartial)
 * @param {boolean} [opts.filterPartial]
 * @returns {Array<object>}
 */
function listJobs(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const appFilter =
    o.appName != null && String(o.appName).trim()
      ? String(o.appName).trim().toLowerCase()
      : null;
  const partial = o.filterPartial === true;
  const out = [];
  for (const [appName, appMap] of appJobs.entries()) {
    if (appFilter) {
      const an = appName.toLowerCase();
      if (partial) {
        if (!an.includes(appFilter)) continue;
      } else if (an !== appFilter) {
        continue;
      }
    }
    for (const [jobName, runtime] of appMap.entries()) {
      const next =
        runtime.cronJob && runtime.cronJob.nextRun && runtime.cronJob.nextRun();
      const t = runtime.def.target || {};
      out.push({
        appName,
        name: jobName,
        cron: runtime.def.cron,
        timezone: runtime.def.timezone,
        target: t,
        targetType: t.type || null,
        targetSummary: summarizeTarget(t),
        running: runtime.running,
        lastStartedAt: runtime.lastStartedAt,
        lastFinishedAt: runtime.lastFinishedAt,
        lastStatus: runtime.lastStatus,
        lastError: runtime.lastError,
        nextRunAt: next ? next.toISOString() : null,
      });
    }
  }
  out.sort((a, b) => {
    const c = a.appName.localeCompare(b.appName);
    return c !== 0 ? c : a.name.localeCompare(b.name);
  });
  return out;
}

/**
 * @private
 */
function summarizeTarget(t) {
  if (!t || !t.type) return "—";
  if (t.type === "script") return `script:${t.path || "?"}`;
  if (t.type === "url") return `url:${t.method || "GET"} ${t.url || "?"}`;
  if (t.type === "queue") return `queue:${t.job || "?"}`;
  return String(t.type);
}

/**
 * Admin/status snapshot for Glade.
 * @returns {object}
 */
function getAdminStatus() {
  const jobs = listJobs();
  let running = 0;
  for (const j of jobs) {
    if (j.running) running++;
  }
  return {
    enabled: serverConfig.enabled === true,
    timezone: serverConfig.timezone || "UTC",
    coordination: {
      driver:
        (serverConfig.coordination && serverConfig.coordination.driver) ||
        "none",
      strategy:
        (serverConfig.coordination && serverConfig.coordination.strategy) ||
        "tick",
    },
    jobCount: jobs.length,
    runningCount: running,
  };
}

/**
 * Force-run a registered job (tests / Glade "Run now").
 * Bypasses multi-node coordination so an operator can always trigger a run.
 * @param {string} appName
 * @param {string} jobName
 * @returns {Promise<object>} result status snapshot
 */
async function runNow(appName, jobName) {
  const appMap = appJobs.get(appName);
  if (!appMap || !appMap.has(jobName)) {
    throw new Error(
      `No registered schedule '${jobName}' for app '${appName}'.`,
    );
  }
  const runtime = appMap.get(jobName);
  if (!runtime.app) {
    throw new Error(
      `Internal error: runtime missing app for '${appName}/${jobName}'.`,
    );
  }
  await runJob(runtime.app, runtime, { force: true });
  return {
    appName,
    name: jobName,
    lastStatus: runtime.lastStatus,
    lastError: runtime.lastError,
    lastStartedAt: runtime.lastStartedAt,
    lastFinishedAt: runtime.lastFinishedAt,
    running: runtime.running,
  };
}

/**
 * @private
 */
function _resetForTests() {
  for (const appName of [...appJobs.keys()]) {
    const appMap = appJobs.get(appName);
    if (appMap) {
      for (const runtime of appMap.values()) {
        try {
          if (runtime.cronJob) runtime.cronJob.stop();
        } catch (_) {
          /* ignore */
        }
      }
    }
    appJobs.delete(appName);
  }
  if (coordinator) {
    coordinator.shutdown().catch(() => {});
    coordinator = null;
  }
  serverConfig = {
    enabled: false,
    timezone: "UTC",
    coordination: {
      driver: COORDINATION_DEFAULTS.driver,
      strategy: COORDINATION_DEFAULTS.strategy,
      lock_ttl_ms: COORDINATION_DEFAULTS.lock_ttl_ms,
      slot_granularity_ms: COORDINATION_DEFAULTS.slot_granularity_ms,
      node_id: null,
    },
    redis: null,
  };
  serverLogger = null;
  globalConfigRef = null;
}

/**
 * Inject a coordinator (unit tests). Pass null to clear.
 * @private
 */
function _setCoordinatorForTests(c) {
  coordinator = c;
}

module.exports = {
  initServer,
  registerApp,
  unregisterApp,
  reinitApp,
  shutdown,
  listJobs,
  getAdminStatus,
  runNow,
  // private test helpers
  _normalizeSchedule: normalizeSchedule,
  _resetForTests,
  _getServerConfig: () => ({
    ...serverConfig,
    coordination: { ...serverConfig.coordination },
  }),
  _runJob: runJob,
  _setCoordinatorForTests,
};
