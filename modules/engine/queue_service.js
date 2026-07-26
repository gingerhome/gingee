/**
 * @module engine/queue_service
 * @description Background job queue orchestration (memory / redis drivers).
 * Engine-internal — apps use require('queue').
 */

const path = require('path');
const fs = require('fs');
const { als } = require('../gingee.js');
const { runInGBox } = require('../gbox.js');
const { isPathInside } = require('../internal_utils.js');
const metrics = require('../metrics.js');
const { createMemoryDriver } = require('../queue_drivers/memory.js');
const { createRedisDriver } = require('../queue_drivers/redis.js');

const engineRoot = path.resolve(__dirname, '..', '..');

const DEFAULTS = {
  enabled: true,
  driver: 'memory', // memory | redis
  concurrency: 5,
  default_attempts: 3,
  default_backoff_ms: 1000,
  /** Default script dir under box/ when job name has no mapping */
  jobs_dir: 'jobs',
  redis: {
    url: null,
    host: '127.0.0.1',
    port: 6379,
    password: null,
    db: 0,
    key_prefix: 'gingee:queue:'
  }
};

/** @type {object} */
let serverConfig = { ...DEFAULTS, redis: { ...DEFAULTS.redis } };
/** @type {object|null} */
let serverLogger = null;
/** @type {object|null} */
let globalConfigRef = null;
/** @type {object|null} */
let appsRegistry = null;
/** @type {object|null} */
let driver = null;

let inFlight = 0;
/** @type {object[]} */
const waitQueue = [];
/** Jobs currently executing on this node (id → job snapshot) */
/** @type {Map<string, object>} */
const activeJobs = new Map();
let processing = false;

function log() {
  return serverLogger || console;
}

function positiveInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * @param {object|null|undefined} cfg
 * @param {object} logger
 * @param {object} globalConfig
 */
async function initServer(cfg, logger, globalConfig) {
  serverLogger = logger || console;
  globalConfigRef = globalConfig || null;
  const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  serverConfig = {
    enabled: c.enabled !== false,
    driver: (c.driver && String(c.driver).toLowerCase()) || DEFAULTS.driver,
    concurrency: positiveInt(c.concurrency, DEFAULTS.concurrency),
    default_attempts: positiveInt(c.default_attempts, DEFAULTS.default_attempts),
    default_backoff_ms: positiveInt(c.default_backoff_ms, DEFAULTS.default_backoff_ms),
    jobs_dir: (c.jobs_dir && String(c.jobs_dir).trim()) || DEFAULTS.jobs_dir,
    redis: {
      ...DEFAULTS.redis,
      ...(c.redis && typeof c.redis === 'object' ? c.redis : {})
    }
  };

  if (driver) {
    try {
      await driver.shutdown();
    } catch (_) {
      /* ignore */
    }
    driver = null;
  }

  if (!serverConfig.enabled) {
    log().info('[queue] Disabled (queue.enabled is false).');
    return;
  }

  const onReady = (job) => {
    waitQueue.push(job);
    pump();
  };

  if (serverConfig.driver === 'redis') {
    try {
      driver = createRedisDriver({
        redis: serverConfig.redis,
        keyPrefix: serverConfig.redis.key_prefix || DEFAULTS.redis.key_prefix,
        onReady,
        logger: log()
      });
      await driver.start();
      log().info('[queue] Redis driver started');
    } catch (e) {
      log().error(`[queue] Redis driver failed (${e.message}); falling back to memory`);
      driver = createMemoryDriver({ onReady, logger: log() });
      await driver.start();
    }
  } else {
    driver = createMemoryDriver({ onReady, logger: log() });
    await driver.start();
    log().info('[queue] Memory driver started (not durable across restarts)');
  }

  log().info(
    `[queue] enabled driver=${driver.name} concurrency=${serverConfig.concurrency}`
  );
}

/**
 * @param {object|null} apps
 */
function setAppsRegistry(apps) {
  appsRegistry = apps || null;
}

function isEnabled() {
  return !!(serverConfig.enabled && driver);
}

/**
 * Resolve relative job script under app box.
 * @param {object} app
 * @param {string} jobName
 * @param {string} [scriptOverride]
 */
function resolveJobScript(app, jobName, scriptOverride) {
  const appQueue = (app.config && app.config.queue) || {};
  const jobsMap = appQueue.jobs && typeof appQueue.jobs === 'object' ? appQueue.jobs : {};
  let rel =
    scriptOverride ||
    (jobsMap[jobName] && (jobsMap[jobName].script || jobsMap[jobName].path)) ||
    null;

  if (!rel) {
    // Sanitize job name for path segment
    const safe = String(jobName).replace(/[^\w.-]/g, '_');
    rel = path.join(serverConfig.jobs_dir || 'jobs', `${safe}.js`).replace(/\\/g, '/');
  }

  rel = String(rel).replace(/\\/g, '/').replace(/^\/+/, '');
  if (path.isAbsolute(rel) || rel.includes('\0') || rel.includes('..')) {
    throw new Error(`Invalid job script path: ${rel}`);
  }

  const full = path.resolve(app.appBoxPath, rel);
  if (!isPathInside(full, app.appBoxPath)) {
    throw new Error(`Job script escapes box: ${rel}`);
  }
  if (!fs.existsSync(full)) {
    throw new Error(`Job script not found: ${rel} (expected under box/)`);
  }
  return { relative: rel, absolute: full };
}

/**
 * Enqueue a job for an app (engine entry; permission checked by public module).
 * @param {object} app
 * @param {string} name
 * @param {*} payload
 * @param {object} [options]
 */
async function addJob(app, name, payload, options = {}) {
  if (!isEnabled()) {
    throw new Error('Queue is disabled on this server (queue.enabled is false).');
  }
  if (!app || !app.name) throw new Error('queue.add requires an app context.');
  if (app.in_maintenance) {
    throw new Error(`App '${app.name}' is in maintenance; cannot enqueue.`);
  }

  const jobName = String(name || '').trim();
  if (!jobName) throw new Error('queue.add requires a job name.');

  const { relative } = resolveJobScript(app, jobName, options.script);

  const maxAttempts =
    options.attempts != null
      ? positiveInt(options.attempts, serverConfig.default_attempts)
      : serverConfig.default_attempts;
  const backoffMs =
    options.backoffMs != null
      ? positiveInt(options.backoffMs, serverConfig.default_backoff_ms)
      : serverConfig.default_backoff_ms;
  const delayMs = options.delayMs != null ? Math.max(0, Number(options.delayMs) || 0) : 0;

  const result = await driver.enqueue({
    appName: app.name,
    name: jobName,
    script: relative,
    payload: payload === undefined ? null : payload,
    attempt: 1,
    maxAttempts,
    backoffMs,
    delayMs
  });

  try {
    metrics.inc('gingee_queue_jobs_enqueued_total', { app: app.name, job: jobName });
  } catch (_) {
    /* ignore */
  }

  log().info(
    `[queue] Enqueued job '${jobName}' id=${result.id} app=${app.name} delayMs=${delayMs}`
  );
  return result;
}

function pump() {
  if (processing) return;
  processing = true;
  setImmediate(runPump);
}

async function runPump() {
  try {
    while (inFlight < serverConfig.concurrency && waitQueue.length > 0) {
      const job = waitQueue.shift();
      inFlight++;
      activeJobs.set(job.id, {
        ...job,
        state: 'running',
        scope: 'node',
        startedAt: Date.now()
      });
      processOne(job)
        .catch((e) => log().error(`[queue] process error: ${e.message}`))
        .finally(() => {
          inFlight--;
          activeJobs.delete(job.id);
          pump();
        });
    }
  } finally {
    processing = false;
    if (inFlight < serverConfig.concurrency && waitQueue.length > 0) {
      pump();
    }
  }
}

/**
 * @param {object} job
 */
async function processOne(job) {
  const app = appsRegistry && appsRegistry[job.appName];
  if (!app) {
    log().error(`[queue] No app '${job.appName}' for job ${job.id}; dropping.`);
    try {
      await driver.fail(job.id);
    } catch (_) {
      /* ignore */
    }
    return;
  }

  if (app.in_maintenance) {
    log().warn(`[queue] App '${app.name}' in maintenance; delaying job ${job.id}`);
    try {
      // Same attempt; short delay until app is out of maintenance
      await driver.enqueue({
        ...job,
        delayMs: 2000,
        attempt: job.attempt || 1
      });
    } catch (e) {
      log().error(`[queue] re-queue failed: ${e.message}`);
    }
    return;
  }

  const perms = app.grantedPermissions || [];
  if (!perms.includes('queue')) {
    log().error(
      `[queue] App '${app.name}' lost queue permission; failing job ${job.id}`
    );
    try {
      await driver.fail(job.id);
      metrics.inc('gingee_queue_jobs_failed_total', { app: app.name, job: job.name });
    } catch (_) {
      /* ignore */
    }
    return;
  }

  let scriptAbs;
  try {
    scriptAbs = resolveJobScript(app, job.name, job.script).absolute;
  } catch (e) {
    log().error(`[queue] ${e.message}`);
    await failOrRetry(job, e);
    return;
  }

  const cfg = globalConfigRef || {};
  const gBoxConfig = {
    appName: app.name,
    app,
    appBoxPath: app.appBoxPath,
    globalModulesPath: path.join(engineRoot, 'modules'),
    allowedBuiltinModules: (cfg.box && cfg.box.allowed_modules) || [],
    privilegedApps: cfg.privileged_apps || [],
    useCache: true,
    logger: app.logger || log(),
    globalConfig: cfg,
    allowCodeGeneration: !cfg.box || cfg.box.allow_code_generation !== false
  };

  const started = Date.now();
  try {
    await als.run(
      {
        appName: app.name,
        app,
        logger: app.logger || log(),
        globalConfig: cfg,
        scriptPath: scriptAbs,
        scriptFolder: path.dirname(scriptAbs),
        isQueue: true,
        queueJob: {
          id: job.id,
          name: job.name,
          payload: job.payload,
          attempt: job.attempt || 1,
          maxAttempts: job.maxAttempts || serverConfig.default_attempts
        },
        queuePayload: job.payload
      },
      async () => {
        const mod = runInGBox(scriptAbs, gBoxConfig);
        if (typeof mod !== 'function') {
          throw new Error(`Job script ${job.script} did not export a function.`);
        }
        await mod();
      }
    );

    await driver.complete(job.id);
    try {
      metrics.inc('gingee_queue_jobs_completed_total', { app: app.name, job: job.name });
      metrics.observe(
        'gingee_queue_job_duration_seconds',
        { app: app.name, job: job.name },
        (Date.now() - started) / 1000
      );
    } catch (_) {
      /* ignore */
    }
    log().info(
      `[queue] Job '${job.name}' id=${job.id} app=${app.name} completed (attempt ${job.attempt})`
    );
  } catch (err) {
    log().error(
      `[queue] Job '${job.name}' id=${job.id} app=${app.name} failed: ${err.message}`
    );
    await failOrRetry(job, err);
  }
}

/**
 * @param {object} job
 * @param {Error} err
 */
async function failOrRetry(job, err) {
  const attempt = job.attempt || 1;
  const max = job.maxAttempts || serverConfig.default_attempts;
  if (attempt < max) {
    try {
      await driver.retry(job);
      metrics.inc('gingee_queue_jobs_retried_total', {
        app: job.appName,
        job: job.name
      });
      log().info(
        `[queue] Retrying job '${job.name}' id=${job.id} attempt ${attempt + 1}/${max}`
      );
    } catch (e) {
      log().error(`[queue] retry enqueue failed: ${e.message}`);
      try {
        await moveToDlq(job, e);
      } catch (_) {
        /* ignore */
      }
    }
  } else {
    try {
      await moveToDlq(job, err);
      metrics.inc('gingee_queue_jobs_failed_total', {
        app: job.appName,
        job: job.name
      });
    } catch (_) {
      /* ignore */
    }
    log().error(
      `[queue] Job '${job.name}' id=${job.id} permanently failed after ${attempt} attempt(s): ${err.message}`
    );
  }
}

/**
 * @param {object} job
 * @param {Error|string} err
 */
async function moveToDlq(job, err) {
  if (!driver) return;
  if (typeof driver.deadLetter === 'function') {
    await driver.deadLetter(job, err);
  } else if (typeof driver.fail === 'function') {
    await driver.fail(job.id);
  }
  try {
    metrics.inc('gingee_queue_dlq_total', { app: job.appName || 'unknown', job: job.name || 'unknown' });
  } catch (_) {
    /* ignore */
  }
}

// --- Admin / Glade APIs (privileged platform only) ---

/**
 * @returns {Promise<object>}
 */
async function getAdminStats() {
  const base = getStats();
  let dlqCount = 0;
  if (driver && typeof driver.dlqSize === 'function') {
    try {
      dlqCount = await driver.dlqSize();
    } catch (_) {
      dlqCount = 0;
    }
  }
  let pending = null;
  let delayed = null;
  if (driver && typeof driver.pendingCounts === 'function') {
    try {
      const c = await driver.pendingCounts();
      pending = c.pending;
      delayed = c.delayed;
    } catch (_) {
      /* ignore */
    }
  }
  return {
    ...base,
    dlqCount,
    /** Driver-level ready pool size (redis: shared; memory: includes not-yet-claimed) */
    pendingCount: pending,
    /** Driver-level delayed count */
    delayedCount: delayed,
    default_attempts: serverConfig.default_attempts,
    default_backoff_ms: serverConfig.default_backoff_ms
  };
}

/**
 * Live jobs: running/waiting on this node + pending/delayed in the driver.
 * @param {object} [opts]
 * @param {string} [opts.appName]
 * @param {number} [opts.limit]
 * @returns {Promise<object[]>}
 */
async function listLiveJobs(opts = {}) {
  const limit = opts.limit != null ? Math.min(500, Math.max(1, Number(opts.limit))) : 100;
  const appFilter =
    opts.appName != null && String(opts.appName).trim()
      ? String(opts.appName).trim()
      : null;
  const seen = new Set();
  const out = [];

  function push(job) {
    if (!job || !job.id || seen.has(job.id)) return;
    if (appFilter && job.appName !== appFilter) return;
    seen.add(job.id);
    const { _timer, ...rest } = job;
    out.push(rest);
  }

  // 1) Running on this node
  for (const job of activeJobs.values()) {
    push(job);
    if (out.length >= limit) return out;
  }

  // 2) Claimed into this node's wait queue (not started)
  for (const job of waitQueue) {
    push({
      ...job,
      state: 'waiting',
      scope: 'node'
    });
    if (out.length >= limit) return out;
  }

  // 3) Driver pending / delayed (memory local or redis shared)
  if (driver && typeof driver.listPending === 'function') {
    try {
      const pending = await driver.listPending({
        appName: appFilter || undefined,
        limit: limit
      });
      for (const job of pending) {
        push(job);
        if (out.length >= limit) break;
      }
    } catch (e) {
      log().error(`[queue] listPending failed: ${e.message}`);
    }
  }

  return out;
}

/**
 * @param {object} [opts]
 * @param {string} [opts.appName]
 * @param {number} [opts.limit]
 * @returns {Promise<object[]>}
 */
async function listDlq(opts = {}) {
  if (!driver || typeof driver.listDlq !== 'function') return [];
  return driver.listDlq(opts);
}

/**
 * @param {string} jobId
 * @returns {Promise<object|null>}
 */
async function getDlqJob(jobId) {
  if (!driver || typeof driver.getDlqJob !== 'function') return null;
  return driver.getDlqJob(jobId);
}

/**
 * Re-enqueue a dead-lettered job (attempt reset to 1).
 * @param {string} jobId
 * @returns {Promise<object>}
 */
async function retryDlqJob(jobId) {
  if (!isEnabled() || !driver) {
    throw new Error('Queue is disabled or not started.');
  }
  if (typeof driver.retryDlq !== 'function') {
    throw new Error('Queue driver does not support DLQ retry.');
  }
  // Fresh attempt budget so admin retry is useful even if original maxAttempts was 1
  const result = await driver.retryDlq(jobId, {
    maxAttempts: serverConfig.default_attempts || 3
  });
  if (!result) {
    throw new Error(`DLQ job not found: ${jobId}`);
  }
  try {
    metrics.inc('gingee_queue_dlq_retry_total', { app: result.appName || 'unknown' });
  } catch (_) {
    /* ignore */
  }
  log().info(`[queue] DLQ retry id=${jobId} app=${result.appName} job=${result.name}`);
  return result;
}

/**
 * Remove a job from the DLQ without re-running.
 * @param {string} jobId
 * @returns {Promise<boolean>}
 */
async function discardDlqJob(jobId) {
  if (!driver || typeof driver.discardDlq !== 'function') {
    throw new Error('Queue driver does not support DLQ discard.');
  }
  const ok = await driver.discardDlq(jobId);
  if (ok) {
    try {
      metrics.inc('gingee_queue_dlq_discard_total', {});
    } catch (_) {
      /* ignore */
    }
    log().info(`[queue] DLQ discarded id=${jobId}`);
  }
  return ok;
}

async function shutdown() {
  waitQueue.length = 0;
  activeJobs.clear();
  if (driver) {
    try {
      await driver.shutdown();
    } catch (_) {
      /* ignore */
    }
    driver = null;
  }
}

function getStats() {
  return {
    enabled: isEnabled(),
    driver: driver ? driver.name : null,
    inFlight,
    waiting: waitQueue.length,
    concurrency: serverConfig.concurrency
  };
}

module.exports = {
  DEFAULTS,
  initServer,
  setAppsRegistry,
  isEnabled,
  addJob,
  resolveJobScript,
  shutdown,
  getStats,
  getAdminStats,
  listDlq,
  listLiveJobs,
  getDlqJob,
  retryDlqJob,
  discardDlqJob,
  /** test helper: process without delay */
  _processOne: processOne,
  _getDriver: () => driver,
  _setAppsRegistry: setAppsRegistry
};
