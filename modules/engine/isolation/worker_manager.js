/**
 * @module engine/isolation/worker_manager
 * @description Fork and manage app/group script workers; IPC for buffered + streaming HTTP scripts.
 * Engine-internal.
 */

const { fork } = require('child_process');
const path = require('path');
const {
  shouldIsolateApp,
  resolveWorkerKey,
  appsForWorker,
  restartDelayMs,
  ISOLATION_DEFAULTS
} = require('./policy.js');
const { projectRoot } = require('../paths.js');

/** @type {Map<string, object>} workerKey → handle */
const workers = new Map();

/** @type {Map<string, string>} appName → workerKey */
const appWorkerKeys = new Map();

/** @type {Map<string, object>} appName → last known app snapshot for restarts */
const appSnapshots = new Map();

/** @type {Map<string, NodeJS.Timeout>} workerKey → pending restart timer */
const restartTimers = new Map();

/** @type {object|null} */
let serverConfig = null;
/** @type {object|null} */
let serverLogger = null;
/** @type {string} */
let webPathResolved = '';
/** @type {object|null} full apps registry for group membership */
let appsRegistry = null;

/**
 * @param {object} config
 * @param {object} logger
 * @param {string} webPath
 * @param {object} [apps] - live apps map for group resolution
 */
function init(config, logger, webPath, apps) {
  serverConfig = config;
  serverLogger = logger || console;
  webPathResolved = webPath;
  if (apps) appsRegistry = apps;
}

/**
 * Update live apps registry (call after initializeApps / reload).
 * @param {object} apps
 */
function setAppsRegistry(apps) {
  appsRegistry = apps || null;
}

function log() {
  return serverLogger || console;
}

function isolationOpts() {
  return {
    ...ISOLATION_DEFAULTS,
    ...((serverConfig && serverConfig.isolation) || {}),
    groups: {
      ...ISOLATION_DEFAULTS.groups,
      ...((serverConfig && serverConfig.isolation && serverConfig.isolation.groups) || {})
    },
    apps: (serverConfig && serverConfig.isolation && serverConfig.isolation.apps) || ISOLATION_DEFAULTS.apps
  };
}

function shouldIsolate(app, config) {
  return shouldIsolateApp(app, config || serverConfig || {});
}

/**
 * Remember app for restarts / group init.
 * @param {object} app
 */
function rememberApp(app) {
  if (!app || !app.name) return;
  appSnapshots.set(app.name, {
    name: app.name,
    config: app.config ? JSON.parse(JSON.stringify(app.config)) : {},
    appWebPath: app.appWebPath,
    appBoxPath: app.appBoxPath,
    grantedPermissions: Array.isArray(app.grantedPermissions)
      ? [...app.grantedPermissions]
      : []
  });
}

/**
 * Build multi-app init payload for a worker key.
 * @param {string} workerKey
 * @param {object} cfg
 * @param {string[]} appNames
 */
function buildInitPayload(workerKey, cfg, appNames) {
  const apps = [];
  for (const name of appNames) {
    const snap = appSnapshots.get(name);
    if (!snap) continue;
    apps.push({
      appName: name,
      appWebPath: snap.appWebPath,
      appBoxPath: snap.appBoxPath,
      appConfig: snap.config,
      grantedPermissions: snap.grantedPermissions
    });
  }
  return {
    type: 'init',
    workerKey,
    projectRoot,
    webPath: webPathResolved,
    apps,
    privilegedApps: Array.isArray(cfg.privileged_apps) ? [...cfg.privileged_apps] : [],
    allowedBuiltinModules:
      cfg.box && Array.isArray(cfg.box.allowed_modules) ? [...cfg.box.allowed_modules] : [],
    allowCodeGeneration: !cfg.box || cfg.box.allow_code_generation !== false,
    // Pass module defaults so the worker can re-init ai/email adapters
    // (process-local maps are empty in the child after fork).
    globalConfig: {
      box: cfg.box ? { ...cfg.box } : {},
      privileged_apps: cfg.privileged_apps || [],
      max_body_size: cfg.max_body_size,
      isolation: cfg.isolation,
      ai: cfg.ai && typeof cfg.ai === 'object' ? { ...cfg.ai } : null,
      email: cfg.email && typeof cfg.email === 'object' ? { ...cfg.email } : null
    }
  };
}

/**
 * Start (or restart) the worker that hosts this app (app-scoped or group).
 * @param {object} app
 * @param {object} [config]
 * @param {object} [options]
 * @param {boolean} [options.fromRestart]
 * @returns {Promise<object|null>}
 */
function startWorker(app, config, options = {}) {
  const cfg = config || serverConfig;
  if (!shouldIsolate(app, cfg)) {
    return Promise.resolve(null);
  }

  rememberApp(app);
  const workerKey = resolveWorkerKey(app, cfg);
  if (!workerKey) return Promise.resolve(null);

  // Cancel pending restart for this key
  if (restartTimers.has(workerKey)) {
    clearTimeout(restartTimers.get(workerKey));
    restartTimers.delete(workerKey);
  }

  const memberNames = appsForWorker(app, cfg, appsRegistry || { [app.name]: app });
  // Ensure all members are remembered if present in registry
  if (appsRegistry) {
    for (const n of memberNames) {
      if (appsRegistry[n]) rememberApp(appsRegistry[n]);
    }
  }

  const prev = workers.get(workerKey);
  const prevRestarts = prev && typeof prev.restarts === 'number' ? prev.restarts : 0;
  stopWorkerByKey(workerKey, { silent: true, intentional: true });

  const workerScript = path.join(__dirname, 'app_worker.js');
  const opts = isolationOpts();
  const readyTimeout = opts.worker_ready_timeout_ms || ISOLATION_DEFAULTS.worker_ready_timeout_ms;

  const child = fork(workerScript, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      GINGEE_WORKER: '1',
      GINGEE_WORKER_KEY: workerKey
    }
  });

  const handle = {
    child,
    workerKey,
    appNames: memberNames,
    ready: false,
    pending: new Map(),
    streams: new Map(),
    restarts: options.fromRestart ? prevRestarts + 1 : 0,
    stopping: false,
    readySince: null
  };

  workers.set(workerKey, handle);
  for (const n of memberNames) {
    appWorkerKeys.set(n, workerKey);
  }

  child.stdout &&
    child.stdout.on('data', (d) => {
      log().info(`[worker:${workerKey}:stdout] ${String(d).trim()}`);
    });
  child.stderr &&
    child.stderr.on('data', (d) => {
      log().warn(`[worker:${workerKey}:stderr] ${String(d).trim()}`);
    });

  child.on('message', (msg) => onWorkerMessage(handle, msg));

  child.on('exit', (code, signal) => {
    log().warn(
      `[isolation] Worker '${workerKey}' exited code=${code} signal=${signal || ''} (restarts=${handle.restarts})`
    );
    failPending(handle, new Error(`App worker '${workerKey}' exited`));
    handle.ready = false;

    const intentional = handle.stopping;
    if (workers.get(workerKey) === handle) {
      workers.delete(workerKey);
    }

    if (!intentional) {
      scheduleAutoRestart(workerKey, handle.restarts, memberNames, cfg);
    }
  });

  child.on('error', (err) => {
    log().error(`[isolation] Worker error for '${workerKey}': ${err.message}`);
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Worker '${workerKey}' did not become ready within ${readyTimeout}ms`));
      try {
        child.kill();
      } catch (_) {
        /* ignore */
      }
    }, readyTimeout);

    const onMsg = (msg) => {
      if (msg && msg.type === 'ready') {
        clearTimeout(timer);
        child.removeListener('message', onMsg);
        handle.ready = true;
        handle.readySince = Date.now();
        log().info(
          `[isolation] Worker ready '${workerKey}' apps=[${memberNames.join(',')}] pid=${child.pid}`
        );
        resolve(handle);
      }
    };
    child.on('message', onMsg);
    child.send(buildInitPayload(workerKey, cfg, memberNames), (err) => {
      if (err) {
        clearTimeout(timer);
        child.removeListener('message', onMsg);
        reject(err);
      }
    });
  });
}

/**
 * @param {object} handle
 * @param {object} msg
 */
function onWorkerMessage(handle, msg) {
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'log') {
    const line = `[worker:${handle.workerKey}] ${msg.message}`;
    if (msg.level === 'error') log().error(line);
    else if (msg.level === 'warn') log().warn(line);
    else log().info(line);
    return;
  }

  if (msg.type === 'ready') {
    handle.ready = true;
    handle.readySince = Date.now();
    return;
  }

  // Streaming frames
  if (msg.type === 'stream_start' && msg.requestId) {
    const stream = handle.streams.get(msg.requestId);
    if (!stream || !stream.res || stream.res.headersSent) return;
    try {
      stream.res.statusCode = msg.statusCode || 200;
      const headers = msg.headers || {};
      for (const [k, v] of Object.entries(headers)) {
        if (k.toLowerCase() === 'transfer-encoding') continue;
        stream.res.setHeader(k, v);
      }
      if (typeof stream.res.flushHeaders === 'function') stream.res.flushHeaders();
      stream.started = true;
    } catch (e) {
      log().error(`[isolation] stream_start failed: ${e.message}`);
    }
    return;
  }

  if (msg.type === 'stream_chunk' && msg.requestId) {
    const stream = handle.streams.get(msg.requestId);
    if (!stream || !stream.res) return;
    try {
      const buf = msg.dataBase64 ? Buffer.from(msg.dataBase64, 'base64') : Buffer.alloc(0);
      stream.res.write(buf);
    } catch (e) {
      log().error(`[isolation] stream_chunk failed: ${e.message}`);
    }
    return;
  }

  if (msg.type === 'stream_end' && msg.requestId) {
    const stream = handle.streams.get(msg.requestId);
    const pending = handle.pending.get(msg.requestId);
    if (stream && stream.res && !stream.res.writableEnded) {
      try {
        stream.res.end();
      } catch (_) {
        /* ignore */
      }
    }
    handle.streams.delete(msg.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      handle.pending.delete(msg.requestId);
      pending.resolve({ streamed: true, statusCode: stream && stream.res ? stream.res.statusCode : 200 });
    }
    return;
  }

  if (msg.type === 'stream_error' && msg.requestId) {
    const stream = handle.streams.get(msg.requestId);
    if (stream && stream.res && !stream.res.headersSent) {
      try {
        stream.res.statusCode = 500;
        stream.res.setHeader('Content-Type', 'text/plain');
        stream.res.end(`INTERNAL_SERVER_ERROR - ${msg.error || 'stream error'}`);
      } catch (_) {
        /* ignore */
      }
    } else if (stream && stream.res && !stream.res.writableEnded) {
      try {
        stream.res.end();
      } catch (_) {
        /* ignore */
      }
    }
    handle.streams.delete(msg.requestId);
    const pending = handle.pending.get(msg.requestId);
    if (pending) {
      clearTimeout(pending.timer);
      handle.pending.delete(msg.requestId);
      pending.reject(new Error(msg.error || 'stream error'));
    }
    return;
  }

  if (msg.type === 'http_result' && msg.requestId) {
    // If stream frames already started, stream_end owns completion (ignore buffered result).
    // Streams map always has a slot per request; only `started` means real SSE path.
    const stream = handle.streams.get(msg.requestId);
    if (stream && stream.started) {
      return;
    }
    const pending = handle.pending.get(msg.requestId);
    if (!pending) return;
    clearTimeout(pending.timer);
    handle.pending.delete(msg.requestId);
    handle.streams.delete(msg.requestId);
    pending.resolve(msg);
  }
}

function failPending(handle, err) {
  for (const [id, p] of handle.pending) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  handle.pending.clear();
  for (const [, stream] of handle.streams) {
    if (stream.res && !stream.res.writableEnded) {
      try {
        if (!stream.res.headersSent) {
          stream.res.statusCode = 503;
          stream.res.setHeader('Content-Type', 'text/plain');
          stream.res.end('SERVICE_UNAVAILABLE - worker exited');
        } else {
          stream.res.end();
        }
      } catch (_) {
        /* ignore */
      }
    }
  }
  handle.streams.clear();
}

/**
 * @param {string} workerKey
 * @param {number} restartsSoFar
 * @param {string[]} memberNames
 * @param {object} cfg
 */
function scheduleAutoRestart(workerKey, restartsSoFar, memberNames, cfg) {
  const iso = isolationOpts();
  if (iso.auto_restart === false) {
    log().warn(`[isolation] auto_restart disabled; not restarting '${workerKey}'`);
    return;
  }
  const max = iso.restart_max != null ? Number(iso.restart_max) : ISOLATION_DEFAULTS.restart_max;
  if (restartsSoFar >= max) {
    log().error(
      `[isolation] Worker '${workerKey}' exceeded restart_max=${max}; leaving down until next request or reload`
    );
    return;
  }

  const delay = restartDelayMs(restartsSoFar, iso);
  log().info(
    `[isolation] Scheduling restart of '${workerKey}' in ${delay}ms (attempt ${restartsSoFar + 1}/${max})`
  );

  if (restartTimers.has(workerKey)) {
    clearTimeout(restartTimers.get(workerKey));
  }

  const timer = setTimeout(() => {
    restartTimers.delete(workerKey);
    // Pick first member that still has a snapshot
    let seedName = null;
    for (const n of memberNames) {
      if (appSnapshots.has(n)) {
        seedName = n;
        break;
      }
    }
    if (!seedName) {
      log().warn(`[isolation] No app snapshot to restart '${workerKey}'`);
      return;
    }
    const snap = appSnapshots.get(seedName);
    const app = {
      name: snap.name,
      config: snap.config,
      appWebPath: snap.appWebPath,
      appBoxPath: snap.appBoxPath,
      grantedPermissions: snap.grantedPermissions
    };
    startWorker(app, cfg, { fromRestart: true }).catch((err) => {
      log().error(`[isolation] Auto-restart failed for '${workerKey}': ${err.message}`);
      scheduleAutoRestart(workerKey, restartsSoFar + 1, memberNames, cfg);
    });
  }, delay);

  restartTimers.set(workerKey, timer);
}

/**
 * Intentional stop (no auto-restart).
 * @param {string} appName
 * @param {object} [opts]
 */
function stopWorker(appName, opts = {}) {
  const workerKey = appWorkerKeys.get(appName) || `app:${appName}`;
  stopWorkerByKey(workerKey, opts);
}

/**
 * @param {string} workerKey
 * @param {object} [opts]
 */
function stopWorkerByKey(workerKey, opts = {}) {
  if (restartTimers.has(workerKey)) {
    clearTimeout(restartTimers.get(workerKey));
    restartTimers.delete(workerKey);
  }

  const handle = workers.get(workerKey);
  if (!handle) {
    // Clear app mappings that pointed here
    for (const [appName, key] of [...appWorkerKeys.entries()]) {
      if (key === workerKey) appWorkerKeys.delete(appName);
    }
    return;
  }

  handle.stopping = opts.intentional !== false; // default intentional when calling stop*

  failPending(handle, new Error(`Worker '${workerKey}' stopped`));

  try {
    if (handle.child.connected) {
      handle.child.send({ type: 'shutdown' });
    }
  } catch (_) {
    /* ignore */
  }

  try {
    handle.child.kill();
  } catch (_) {
    /* ignore */
  }

  workers.delete(workerKey);
  for (const [appName, key] of [...appWorkerKeys.entries()]) {
    if (key === workerKey) appWorkerKeys.delete(appName);
  }
  if (!opts.silent) {
    log().info(`[isolation] Stopped worker '${workerKey}'`);
  }
}

/**
 * Maybe reset restart count after stable uptime.
 * @param {object} handle
 */
function maybeResetRestarts(handle) {
  const iso = isolationOpts();
  const stable =
    iso.restart_stable_ms != null ? Number(iso.restart_stable_ms) : ISOLATION_DEFAULTS.restart_stable_ms;
  if (handle.readySince && Date.now() - handle.readySince >= stable) {
    handle.restarts = 0;
  }
}

/**
 * @param {object} app
 * @param {object} [config]
 */
async function ensureWorker(app, config) {
  if (!shouldIsolate(app, config)) return null;
  rememberApp(app);
  const cfg = config || serverConfig;
  const workerKey = resolveWorkerKey(app, cfg);
  if (!workerKey) return null;

  const existing = workers.get(workerKey);
  if (existing && existing.ready && existing.child && !existing.child.killed) {
    maybeResetRestarts(existing);
    return existing;
  }
  return startWorker(app, cfg);
}

/**
 * Read remaining request body into a Buffer.
 * @param {object} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!req || req.method === 'GET' || req.method === 'HEAD') {
      resolve(Buffer.alloc(0));
      return;
    }
    if (req.complete && !req.readable) {
      resolve(Buffer.alloc(0));
      return;
    }

    const chunks = [];
    let size = 0;
    let settled = false;

    const done = (err, buf) => {
      if (settled) return;
      settled = true;
      req.removeListener('data', onData);
      req.removeListener('end', onEnd);
      req.removeListener('error', onError);
      if (err) reject(err);
      else resolve(buf || Buffer.alloc(0));
    };

    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        done(new Error(`Request body exceeds limit (${maxBytes} bytes)`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    };
    const onEnd = () => done(null, Buffer.concat(chunks));
    const onError = (err) => done(err);

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * Run an HTTP script on the app worker (buffered or streaming).
 * @param {object} opts
 */
async function executeOnWorker(opts) {
  const {
    app,
    config,
    req,
    res,
    scriptPath,
    routeParams,
    maxBodySize,
    useCache,
    logger
  } = opts;

  const handle = await ensureWorker(app, config);
  if (!handle || !handle.ready) {
    throw new Error(`No ready worker for app '${app.name}'`);
  }
  maybeResetRestarts(handle);

  const iso = isolationOpts();
  const timeoutMs = iso.request_timeout_ms || ISOLATION_DEFAULTS.request_timeout_ms;

  let maxBytes = 25 * 1000 * 1000;
  if (typeof maxBodySize === 'string' && /mb$/i.test(maxBodySize)) {
    maxBytes = parseFloat(maxBodySize) * 1000 * 1000;
  }

  const body = await readRequestBody(req, maxBytes);
  const requestId = `${app.name}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // Register stream target so worker can push SSE frames to real res
  handle.streams.set(requestId, { res, started: false });

  const resultMsg = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      handle.pending.delete(requestId);
      handle.streams.delete(requestId);
      reject(new Error(`Worker request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    handle.pending.set(requestId, { resolve, reject, timer });

    const payload = {
      type: 'http_script',
      requestId,
      appName: app.name,
      scriptPath,
      method: req.method,
      url: req.url,
      headers: req.headers,
      bodyBase64: body.length ? body.toString('base64') : '',
      routeParams: routeParams || {},
      maxBodySize: maxBodySize || '25mb',
      useCache: useCache !== false
    };

    try {
      handle.child.send(payload, (err) => {
        if (err) {
          clearTimeout(timer);
          handle.pending.delete(requestId);
          handle.streams.delete(requestId);
          reject(err);
        }
      });
    } catch (err) {
      clearTimeout(timer);
      handle.pending.delete(requestId);
      handle.streams.delete(requestId);
      reject(err);
    }
  });

  // Stream already wrote to res
  if (resultMsg && resultMsg.streamed) {
    handle.streams.delete(requestId);
    return;
  }

  handle.streams.delete(requestId);

  if (resultMsg.error && resultMsg.statusCode >= 500) {
    logger &&
      logger.error(
        `[isolation] Worker script error for '${app.name}': ${resultMsg.error}`
      );
  }

  if (res.headersSent) return;

  const status = resultMsg.statusCode || 200;
  const headers = resultMsg.headers || {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'transfer-encoding') continue;
    try {
      res.setHeader(k, v);
    } catch (_) {
      /* ignore */
    }
  }
  res.statusCode = status;
  const buf = resultMsg.bodyBase64
    ? Buffer.from(resultMsg.bodyBase64, 'base64')
    : Buffer.alloc(0);
  res.end(buf);
}

function shutdownAll() {
  for (const key of [...restartTimers.keys()]) {
    clearTimeout(restartTimers.get(key));
    restartTimers.delete(key);
  }
  for (const workerKey of [...workers.keys()]) {
    stopWorkerByKey(workerKey, { silent: true, intentional: true });
  }
  appWorkerKeys.clear();
}

function getWorkerStats() {
  const out = [];
  for (const [key, h] of workers) {
    out.push({
      workerKey: key,
      appNames: h.appNames,
      pid: h.child && h.child.pid,
      ready: h.ready,
      pending: h.pending.size,
      restarts: h.restarts
    });
  }
  return out;
}

module.exports = {
  init,
  setAppsRegistry,
  shouldIsolate,
  startWorker,
  stopWorker,
  ensureWorker,
  executeOnWorker,
  shutdownAll,
  getWorkerStats,
  readRequestBody,
  rememberApp,
  /** test helpers */
  _workers: workers,
  _appWorkerKeys: appWorkerKeys,
  _appSnapshots: appSnapshots
};
