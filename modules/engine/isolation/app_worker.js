/**
 * App worker process entry (forked by worker_manager).
 * Runs sandboxed server scripts for one app; talks to master via process IPC.
 *
 * Messages in:
 *   { type: 'init', ...snapshot }
 *   { type: 'http_script', requestId, ... }
 *   { type: 'shutdown' }
 *
 * Messages out:
 *   { type: 'ready', appName }
 *   { type: 'http_result', requestId, statusCode, headers, bodyBase64, error? }
 *   { type: 'log', level, message }
 */

const path = require('path');
const fs = require('fs');

// Engine root is parent of modules/ (same layout as main process)
const engineRoot = path.resolve(__dirname, '..', '..', '..');
require('app-module-path').addPath(path.join(engineRoot, 'modules'));

const { isPathInside } = require('../../internal_utils.js');
const { als } = require('../../gingee.js');
const { createGRequire, runInGBox } = require('../../gbox.js');
const { FakeIncomingMessage, FakeServerResponse } = require('./fake_http.js');

/** @type {object|null} */
let appState = null;

const workerLog = {
  info: (msg) => send({ type: 'log', level: 'info', message: String(msg) }),
  warn: (msg) => send({ type: 'log', level: 'warn', message: String(msg) }),
  error: (msg) => send({ type: 'log', level: 'error', message: String(msg) })
};

function send(msg) {
  if (typeof process.send === 'function') {
    process.send(msg);
  }
}

function ensureInit() {
  if (!appState) {
    throw new Error('Worker not initialized');
  }
}

/**
 * Run one script with synthetic HTTP context (mirrors master executeScriptLocal + gingee path).
 */
async function runHttpScript(msg) {
  ensureInit();
  const { app, appBoxPath, globalConfig, privilegedApps, allowedBuiltinModules, allowCodeGeneration } =
    appState;

  const scriptPath = path.resolve(msg.scriptPath);
  if (!isPathInside(scriptPath, appBoxPath)) {
    throw new Error(`Security Error: script path outside app box: ${scriptPath}`);
  }
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const body = msg.bodyBase64
    ? Buffer.from(msg.bodyBase64, 'base64')
    : Buffer.alloc(0);

  const req = new FakeIncomingMessage({
    method: msg.method || 'GET',
    url: msg.url || '/',
    headers: msg.headers || {},
    body
  });
  const res = new FakeServerResponse();

  const gBoxConfig = {
    appName: app.name,
    app,
    appBoxPath,
    globalModulesPath: path.join(engineRoot, 'modules'),
    allowedBuiltinModules: allowedBuiltinModules || [],
    privilegedApps: privilegedApps || [],
    useCache: msg.useCache !== false,
    logger: workerLog,
    globalConfig,
    allowCodeGeneration: allowCodeGeneration !== false
  };

  const store = {
    globalConfig,
    req,
    res,
    projectRoot: appState.projectRoot,
    webPath: appState.webPath,
    appName: app.name,
    isPrivileged: false,
    app,
    allApps: { [app.name]: app },
    appNames: [app.name],
    logger: workerLog,
    routeParams: msg.routeParams || {},
    scriptPath,
    scriptFolder: path.dirname(scriptPath),
    staticFileCache: null,
    transpileCache: null,
    maxBodySize: msg.maxBodySize || '25mb'
  };

  await als.run(store, async () => {
    if (app.config.default_include) {
      const gRequire = createGRequire(scriptPath, gBoxConfig);
      for (const includedPath of app.config.default_include) {
        let includeScript = gRequire(includedPath);
        if (typeof includeScript === 'function') {
          includeScript = await includeScript();
        }
        const includeStore = als.getStore();
        if (includeStore && includeStore.$g && includeStore.$g.isCompleted) {
          return;
        }
      }
    }

    const script = runInGBox(scriptPath, gBoxConfig);
    if (typeof script === 'function') {
      await script();
    } else {
      throw new Error(`Script ${scriptPath} did not export a function.`);
    }
  });

  // If script never called response.send, still return whatever was written
  const result = res.toResult();
  if (!res.writableEnded && result.body.length === 0 && !res.headersSent) {
    // No response — treat as empty 200 (same as hanging avoided by ending)
    result.statusCode = result.statusCode || 200;
  }
  return result;
}

process.on('message', async (msg) => {
  if (!msg || typeof msg !== 'object') return;

  try {
    if (msg.type === 'init') {
      const appName = msg.appName;
      appState = {
        projectRoot: msg.projectRoot,
        webPath: msg.webPath,
        appBoxPath: msg.appBoxPath,
        globalConfig: msg.globalConfig || {},
        privilegedApps: msg.privilegedApps || [],
        allowedBuiltinModules: msg.allowedBuiltinModules || [],
        allowCodeGeneration: msg.allowCodeGeneration !== false,
        app: {
          name: appName,
          config: msg.appConfig || {},
          appWebPath: msg.appWebPath,
          appBoxPath: msg.appBoxPath,
          logger: workerLog,
          grantedPermissions: msg.grantedPermissions || [],
          in_maintenance: false
        }
      };
      send({ type: 'ready', appName });
      return;
    }

    if (msg.type === 'shutdown') {
      process.exit(0);
      return;
    }

    if (msg.type === 'http_script') {
      try {
        const result = await runHttpScript(msg);
        send({
          type: 'http_result',
          requestId: msg.requestId,
          statusCode: result.statusCode,
          headers: result.headers,
          bodyBase64: result.body.toString('base64')
        });
      } catch (err) {
        send({
          type: 'http_result',
          requestId: msg.requestId,
          statusCode: 500,
          headers: { 'content-type': 'text/plain' },
          bodyBase64: Buffer.from(
            `INTERNAL_SERVER_ERROR - ${err.message || String(err)}`,
            'utf8'
          ).toString('base64'),
          error: err.message || String(err)
        });
      }
      return;
    }
  } catch (err) {
    send({
      type: 'log',
      level: 'error',
      message: `Worker message handler failed: ${err.message}`
    });
    if (msg.type === 'http_script' && msg.requestId) {
      send({
        type: 'http_result',
        requestId: msg.requestId,
        statusCode: 500,
        headers: { 'content-type': 'text/plain' },
        bodyBase64: Buffer.from(`INTERNAL_SERVER_ERROR - ${err.message}`, 'utf8').toString(
          'base64'
        ),
        error: err.message
      });
    }
  }
});

// Survive missing master briefly
process.on('disconnect', () => {
  process.exit(0);
});
