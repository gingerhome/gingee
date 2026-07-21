/**
 * @module engine/request/execute_script
 * @description Script execution seam: in-process (default) or app worker IPC.
 * Engine-internal.
 */

const { createGRequire, runInGBox } = require('../../gbox.js');
const { als } = require('../../gingee.js');
const limits = require('../../limits.js');
const workerManager = require('../isolation/worker_manager.js');

/**
 * Run default_include chain + main script inside gbox (local process).
 *
 * @param {object} opts
 * @returns {Promise<void>}
 */
async function executeScriptLocal(opts) {
  const { scriptPath, gBoxConfig, app, acquireToken, res, logger } = opts;

  const store = als.getStore();
  if (store) {
    limits.attachRequestContext(store, acquireToken, res);
  }

  if (app.config.default_include) {
    // Note: default_include scripts are always cached by Node unless the server is restarted.
    const gRequire = createGRequire(scriptPath, gBoxConfig);

    for (const includedPath of app.config.default_include) {
      var includeScript = gRequire(includedPath);
      if (typeof includeScript === 'function') {
        includeScript = await includeScript();
      }

      const includeStore = als.getStore();
      if (includeStore && includeStore.$g && includeStore.$g.isCompleted) {
        logger.info(
          `Request handled by default include '${includedPath}'. Halting execution.`
        );
        return; // release on res finish/close
      }
    }
  }

  const script = runInGBox(scriptPath, gBoxConfig);
  if (typeof script === 'function') {
    await script();
  } else {
    throw new Error(
      `Script ${scriptPath} in app ${app.name || gBoxConfig.appName} did not export a function.`
    );
  }
}

/**
 * Dispatch to worker process (buffered HTTP result applied to real res).
 * @param {object} opts
 */
async function executeScriptRemote(opts) {
  const {
    scriptPath,
    gBoxConfig,
    app,
    acquireToken,
    req,
    res,
    logger,
    useCache
  } = opts;

  // Keep master-side request budget timers tied to the real response.
  const store = als.getStore();
  if (store) {
    limits.attachRequestContext(store, acquireToken, res);
  }

  const routeParams = store && store.routeParams ? store.routeParams : {};
  const maxBodySize =
    (store && store.maxBodySize) ||
    (gBoxConfig.globalConfig && gBoxConfig.globalConfig.max_body_size) ||
    '25mb';

  await workerManager.executeOnWorker({
    app,
    config: gBoxConfig.globalConfig,
    req,
    res,
    scriptPath,
    routeParams,
    maxBodySize,
    useCache: useCache !== false,
    logger
  });
}

/**
 * Execution entry: local by default; worker when isolation policy says so.
 *
 * @param {object} opts
 * @param {object} opts.req - required for remote path
 * @param {object} opts.res
 * @param {object} opts.app
 * @param {object} opts.gBoxConfig
 * @param {object} opts.acquireToken
 * @param {object} opts.logger
 * @param {string} opts.scriptPath
 * @param {boolean} [opts.useCache]
 */
async function executeScript(opts) {
  const config = opts.gBoxConfig && opts.gBoxConfig.globalConfig;
  if (opts.app && config && workerManager.shouldIsolate(opts.app, config)) {
    return executeScriptRemote(opts);
  }
  return executeScriptLocal(opts);
}

module.exports = {
  executeScript,
  executeScriptLocal,
  executeScriptRemote
};
