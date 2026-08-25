/**
 * @module engine/process_guards
 * @description Process-level guards for the Gingee master and isolation workers.
 * Engine-internal — not for sandboxed app require.
 *
 * - **unhandledRejection:** log and keep listening. Detached async throws are not part of
 *   the handler promise awaited by script_runner; without a listener Node's default
 *   (--unhandled-rejections=throw) would exit the whole multi-app process.
 * - **uncaughtException:** log (state may be corrupt), run optional graceful shutdown, then
 *   process.exit(1). Do not keep running quietly after a sync uncaught exception.
 */

const { als } = require("../gingee.js");

/** @type {boolean} */
let rejectionRegistered = false;

/** @type {boolean} */
let uncaughtRegistered = false;

/** @type {function|null} */
let rejectionHandler = null;

/** @type {function|null} */
let uncaughtHandler = null;

/** @type {object|null} */
let activeLogger = null;

/** @type {function|null} */
let onFatalShutdown = null;

/** @type {boolean} */
let fatalInProgress = false;

/**
 * Format a rejection / exception value for logging.
 * @param {*} reason
 * @returns {{ message: string, stack: string|undefined }}
 */
function formatReason(reason) {
  if (reason instanceof Error) {
    return {
      message: reason.message || String(reason),
      stack: reason.stack || undefined,
    };
  }
  if (reason && typeof reason === "object" && reason.message) {
    return {
      message: String(reason.message),
      stack: reason.stack ? String(reason.stack) : undefined,
    };
  }
  return { message: String(reason), stack: undefined };
}

function currentAppName() {
  try {
    const store = als.getStore && als.getStore();
    if (store && store.appName) return store.appName;
  } catch (_) {
    /* ALS may be unavailable */
  }
  return undefined;
}

function logError(tag, message, meta) {
  const logger = activeLogger || console;
  try {
    logger.error(`${tag} ${message}`, meta);
  } catch (_) {
    try {
      console.error(`${tag} ${message}`, (meta && meta.stack) || "");
    } catch (__) {
      /* ignore */
    }
  }
}

/**
 * @param {*} reason
 * @param {Promise} [promise]
 */
function onUnhandledRejection(reason, promise) {
  const { message, stack } = formatReason(reason);
  const meta = {
    stack,
    hasPromise: promise != null,
  };
  const appName = currentAppName();
  if (appName) meta.app = appName;

  logError("[unhandledRejection]", message, meta);
  // Do not rethrow, process.exit, or convert to uncaughtException.
}

/**
 * Sync uncaught exception: log, optional graceful shutdown, then exit.
 * Re-entry safe (second throw during shutdown still forces exit).
 * @param {Error} err
 */
function onUncaughtException(err) {
  const { message, stack } = formatReason(err);
  const meta = {
    stack,
    note: "Process state may be corrupt; shutting down after graceful drain attempt.",
  };
  const appName = currentAppName();
  if (appName) meta.app = appName;

  if (fatalInProgress) {
    logError("[uncaughtException]", `re-entrant: ${message}`, meta);
    try {
      process.exit(1);
    } catch (_) {
      /* ignore */
    }
    return;
  }
  fatalInProgress = true;

  logError("[uncaughtException]", message, meta);

  if (typeof onFatalShutdown === "function") {
    try {
      onFatalShutdown(err);
    } catch (shutdownErr) {
      logError(
        "[uncaughtException]",
        `graceful shutdown failed: ${shutdownErr && shutdownErr.message ? shutdownErr.message : shutdownErr}`,
        {
          stack: shutdownErr && shutdownErr.stack,
        },
      );
    }
  }

  try {
    process.exit(1);
  } catch (_) {
    /* ignore */
  }
}

/**
 * Bind logger / fatal shutdown callback (safe to call on every boot).
 * @param {object} [logger]
 * @param {object} [options]
 * @param {function} [options.onFatalShutdown] - Sync cleanup before exit (master shutdown).
 */
function bindGuardOptions(logger, options) {
  if (logger && typeof logger.error === "function") {
    activeLogger = logger;
  } else if (!activeLogger) {
    activeLogger = console;
  }
  if (options && typeof options.onFatalShutdown === "function") {
    onFatalShutdown = options.onFatalShutdown;
  }
}

/**
 * Register idempotent process.on('unhandledRejection') listener.
 * @param {object} logger
 * @param {object} [options]
 */
function registerUnhandledRejectionGuard(logger, options) {
  bindGuardOptions(logger, options);

  if (rejectionRegistered && rejectionHandler) {
    return;
  }

  rejectionHandler = onUnhandledRejection;
  process.on("unhandledRejection", rejectionHandler);
  rejectionRegistered = true;
}

/**
 * Register idempotent process.on('uncaughtException') listener.
 * Logs, runs options.onFatalShutdown if set, then process.exit(1).
 * @param {object} logger
 * @param {object} [options]
 * @param {function} [options.onFatalShutdown]
 */
function registerUncaughtExceptionGuard(logger, options) {
  bindGuardOptions(logger, options);

  if (uncaughtRegistered && uncaughtHandler) {
    return;
  }

  uncaughtHandler = onUncaughtException;
  process.on("uncaughtException", uncaughtHandler);
  uncaughtRegistered = true;
}

/**
 * Register both process guards (idempotent). Preferred single entry for boot / workers.
 * @param {object} logger
 * @param {object} [options]
 * @param {function} [options.onFatalShutdown] - Called on uncaughtException before exit(1).
 */
function registerProcessGuards(logger, options) {
  registerUnhandledRejectionGuard(logger, options);
  registerUncaughtExceptionGuard(logger, options);
}

/**
 * @private Test helper — remove listeners and reset module state.
 */
function _resetForTests() {
  if (rejectionHandler) {
    process.removeListener("unhandledRejection", rejectionHandler);
  }
  if (uncaughtHandler) {
    process.removeListener("uncaughtException", uncaughtHandler);
  }
  rejectionRegistered = false;
  uncaughtRegistered = false;
  rejectionHandler = null;
  uncaughtHandler = null;
  activeLogger = null;
  onFatalShutdown = null;
  fatalInProgress = false;
}

/**
 * @private Test helper
 */
function _isRegistered() {
  return rejectionRegistered;
}

/**
 * @private Test helper
 */
function _isUncaughtRegistered() {
  return uncaughtRegistered;
}

module.exports = {
  registerProcessGuards,
  registerUnhandledRejectionGuard,
  registerUncaughtExceptionGuard,
  _resetForTests,
  _isRegistered,
  _isUncaughtRegistered,
  _formatReason: formatReason,
  _onUnhandledRejection: onUnhandledRejection,
  _onUncaughtException: onUncaughtException,
};
