/**
 * @module engine/sandbox_console
 * @description Console facade for gbox that forwards to a Winston-like app logger.
 * Engine-internal.
 */

const util = require("util");

/**
 * @param {object} logger - Winston app logger or compatible { info, warn, error, debug }
 * @returns {object} console-like object for the sandbox
 */
function createSandboxConsole(logger) {
  if (!logger || typeof logger !== "object") {
    return console;
  }

  function emit(level, args) {
    let message;
    try {
      message = util.format(...args);
    } catch (_) {
      message = args.map((a) => String(a)).join(" ");
    }
    const fn =
      typeof logger[level] === "function"
        ? logger[level].bind(logger)
        : typeof logger.info === "function"
          ? logger.info.bind(logger)
          : null;
    if (fn) {
      try {
        fn(message);
        return;
      } catch (_) {
        /* fall through */
      }
    }
    try {
      if (typeof console[level] === "function") console[level](message);
      else console.log(message);
    } catch (__) {
      /* ignore */
    }
  }

  return {
    log: (...args) => emit("info", args),
    info: (...args) => emit("info", args),
    warn: (...args) => emit("warn", args),
    error: (...args) => emit("error", args),
    debug: (...args) => emit("debug", args),
    trace: (...args) => emit("debug", args),
  };
}

module.exports = {
  createSandboxConsole,
};
