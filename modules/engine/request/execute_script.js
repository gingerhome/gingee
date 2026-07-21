/**
 * @module engine/request/execute_script
 * @description In-process script execution seam (future: swap for worker IPC).
 * Engine-internal.
 */

const { createGRequire, runInGBox } = require('../../gbox.js');
const { als } = require('../../gingee.js');
const limits = require('../../limits.js');

/**
 * Run default_include chain + main script inside gbox (local process).
 *
 * @param {object} opts
 * @param {string} opts.scriptPath
 * @param {object} opts.gBoxConfig
 * @param {object} opts.app
 * @param {object} opts.acquireToken - from limits.tryAcquireRequest
 * @param {object} opts.res
 * @param {object} opts.logger
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
 * Execution entry used by script_runner. Today always local.
 * Later: if app isolation is process, send IPC instead.
 *
 * @param {object} opts - same as executeScriptLocal
 */
async function executeScript(opts) {
  return executeScriptLocal(opts);
}

module.exports = {
  executeScript,
  executeScriptLocal
};
