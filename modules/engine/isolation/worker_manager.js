/**
 * @module engine/isolation/worker_manager
 * @description Fork and manage per-app script workers; IPC bridge for HTTP scripts.
 * Engine-internal.
 */

const { fork } = require('child_process');
const path = require('path');
const { shouldIsolateApp, ISOLATION_DEFAULTS } = require('./policy.js');
const { engineRoot, projectRoot } = require('../paths.js');

/** @type {Map<string, WorkerHandle>} */
const workers = new Map();

/** @type {object|null} */
let serverConfig = null;
/** @type {object|null} */
let serverLogger = null;
/** @type {string} */
let webPathResolved = '';

/**
 * @typedef {object} WorkerHandle
 * @property {object} child - child_process ChildProcess
 * @property {string} appName
 * @property {boolean} ready
 * @property {Map} pending - requestId → { resolve, reject, timer }
 * @property {number} restarts
 */

/**
 * @param {object} config
 * @param {object} logger
 * @param {string} webPath
 */
function init(config, logger, webPath) {
  serverConfig = config;
  serverLogger = logger || console;
  webPathResolved = webPath;
}

function log() {
  return serverLogger || console;
}

function isolationOpts() {
  return {
    ...ISOLATION_DEFAULTS,
    ...((serverConfig && serverConfig.isolation) || {})
  };
}

/**
 * @param {object} app
 * @param {object} [config]
 */
function shouldIsolate(app, config) {
  return shouldIsolateApp(app, config || serverConfig || {});
}

/**
 * Serializable snapshot for the worker (no functions, no logger).
 * @param {object} app
 * @param {object} config
 */
function buildInitPayload(app, config) {
  const cfg = config || serverConfig;
  return {
    type: 'init',
    appName: app.name,
    projectRoot,
    webPath: webPathResolved,
    appWebPath: app.appWebPath,
    appBoxPath: app.appBoxPath,
    appConfig: app.config ? JSON.parse(JSON.stringify(app.config)) : {},
    grantedPermissions: Array.isArray(app.grantedPermissions)
      ? [...app.grantedPermissions]
      : [],
    privilegedApps: Array.isArray(cfg.privileged_apps) ? [...cfg.privileged_apps] : [],
    allowedBuiltinModules:
      cfg.box && Array.isArray(cfg.box.allowed_modules) ? [...cfg.box.allowed_modules] : [],
    allowCodeGeneration: !cfg.box || cfg.box.allow_code_generation !== false,
    // Minimal global config for gbox / limits awareness (no need for full secrets tree)
    globalConfig: {
      box: cfg.box ? { ...cfg.box } : {},
      privileged_apps: cfg.privileged_apps || [],
      max_body_size: cfg.max_body_size,
      isolation: cfg.isolation
    }
  };
}

/**
 * Start (or restart) a worker for an isolated app.
 * @param {object} app
 * @param {object} [config]
 * @returns {Promise<WorkerHandle>}
 */
function startWorker(app, config) {
  const cfg = config || serverConfig;
  if (!shouldIsolate(app, cfg)) {
    return Promise.resolve(null);
  }

  stopWorker(app.name, { silent: true });

  const workerScript = path.join(__dirname, 'app_worker.js');
  const opts = isolationOpts();
  const readyTimeout = opts.worker_ready_timeout_ms || ISOLATION_DEFAULTS.worker_ready_timeout_ms;

  const child = fork(workerScript, [], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      GINGEE_WORKER: '1',
      GINGEE_WORKER_APP: app.name
    }
  });

  /** @type {WorkerHandle} */
  const handle = {
    child,
    appName: app.name,
    ready: false,
    pending: new Map(),
    restarts: (workers.get(app.name) && workers.get(app.name).restarts) || 0
  };

  workers.set(app.name, handle);

  child.stdout &&
    child.stdout.on('data', (d) => {
      log().info(`[worker:${app.name}:stdout] ${String(d).trim()}`);
    });
  child.stderr &&
    child.stderr.on('data', (d) => {
      log().warn(`[worker:${app.name}:stderr] ${String(d).trim()}`);
    });

  child.on('message', (msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'log') {
      const line = `[worker:${app.name}] ${msg.message}`;
      if (msg.level === 'error') log().error(line);
      else if (msg.level === 'warn') log().warn(line);
      else log().info(line);
      return;
    }

    if (msg.type === 'ready') {
      handle.ready = true;
      log().info(`[isolation] Worker ready for app '${app.name}' (pid ${child.pid})`);
      return;
    }

    if (msg.type === 'http_result' && msg.requestId) {
      const pending = handle.pending.get(msg.requestId);
      if (!pending) return;
      clearTimeout(pending.timer);
      handle.pending.delete(msg.requestId);
      pending.resolve(msg);
    }
  });

  child.on('exit', (code, signal) => {
    log().warn(
      `[isolation] Worker for '${app.name}' exited code=${code} signal=${signal || ''}`
    );
    // Fail all pending
    for (const [, p] of handle.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(`App worker for '${app.name}' exited`));
    }
    handle.pending.clear();
    handle.ready = false;
    if (workers.get(app.name) === handle) {
      workers.delete(app.name);
    }
  });

  child.on('error', (err) => {
    log().error(`[isolation] Worker error for '${app.name}': ${err.message}`);
  });

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Worker for '${app.name}' did not become ready within ${readyTimeout}ms`));
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
        resolve(handle);
      }
    };
    // Listen before init so we cannot miss 'ready'
    child.on('message', onMsg);
    child.send(buildInitPayload(app, cfg), (err) => {
      if (err) {
        clearTimeout(timer);
        child.removeListener('message', onMsg);
        reject(err);
      }
    });
  });
}

/**
 * @param {string} appName
 * @param {object} [opts]
 */
function stopWorker(appName, opts = {}) {
  const handle = workers.get(appName);
  if (!handle) return;

  for (const [, p] of handle.pending) {
    clearTimeout(p.timer);
    p.reject(new Error(`Worker for '${appName}' stopped`));
  }
  handle.pending.clear();

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

  workers.delete(appName);
  if (!opts.silent) {
    log().info(`[isolation] Stopped worker for app '${appName}'`);
  }
}

/**
 * Ensure a worker is running for the app.
 * @param {object} app
 * @param {object} [config]
 */
async function ensureWorker(app, config) {
  if (!shouldIsolate(app, config)) return null;
  const existing = workers.get(app.name);
  if (existing && existing.ready && existing.child && !existing.child.killed) {
    return existing;
  }
  return startWorker(app, config);
}

/**
 * Read remaining request body into a Buffer.
 * @param {object} req - Node HTTP IncomingMessage
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    if (!req || req.method === 'GET' || req.method === 'HEAD') {
      resolve(Buffer.alloc(0));
      return;
    }
    // If something already consumed the body, best-effort empty
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
 * Run an HTTP script on the app worker and apply the result to res.
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

  const iso = isolationOpts();
  const timeoutMs = iso.request_timeout_ms || ISOLATION_DEFAULTS.request_timeout_ms;

  // Parse max body roughly for buffering (25mb default string handled loosely)
  let maxBytes = 25 * 1000 * 1000;
  if (typeof maxBodySize === 'string' && /mb$/i.test(maxBodySize)) {
    maxBytes = parseFloat(maxBodySize) * 1000 * 1000;
  }

  const body = await readRequestBody(req, maxBytes);
  const requestId = `${app.name}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const resultMsg = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      handle.pending.delete(requestId);
      reject(new Error(`Worker request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    handle.pending.set(requestId, { resolve, reject, timer });

    const payload = {
      type: 'http_script',
      requestId,
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
          reject(err);
        }
      });
    } catch (err) {
      clearTimeout(timer);
      handle.pending.delete(requestId);
      reject(err);
    }
  });

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
      /* ignore invalid headers */
    }
  }
  res.statusCode = status;
  const buf = resultMsg.bodyBase64
    ? Buffer.from(resultMsg.bodyBase64, 'base64')
    : Buffer.alloc(0);
  res.end(buf);
}

function shutdownAll() {
  for (const appName of [...workers.keys()]) {
    stopWorker(appName, { silent: true });
  }
}

function getWorkerStats() {
  const out = [];
  for (const [name, h] of workers) {
    out.push({
      appName: name,
      pid: h.child && h.child.pid,
      ready: h.ready,
      pending: h.pending.size
    });
  }
  return out;
}

module.exports = {
  init,
  shouldIsolate,
  startWorker,
  stopWorker,
  ensureWorker,
  executeOnWorker,
  shutdownAll,
  getWorkerStats,
  readRequestBody,
  /** test helper */
  _workers: workers
};
