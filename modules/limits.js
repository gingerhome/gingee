/**
 * @module limits
 * @description
 * Platform request concurrency, wall-clock request budgets, and outbound HTTP defaults.
 *
 * <b>Server config:</b> `gingee.json` → `limits` (see docs/server-config.md).
 * <b>App config:</b> optional `app.json` → `limits` may only <em>tighten</em> (lower) server ceilings.
 *
 * Engine-internal (not for sandboxed app require).
 */

const DEFAULTS = {
  request_timeout_ms: 30000,
  request_timeout_stream_ms: 300000,
  stream_idle_timeout_ms: 60000,
  outbound_timeout_ms: 15000,
  max_concurrent_requests: 100,
  max_concurrent_requests_per_app: 25,
  max_concurrent_outbound: 50,
  // Node HTTP server (ms). Slightly above request budget to allow body read + script.
  headers_timeout_ms: 60000,
  request_timeout_server_ms: 120000,
  keep_alive_timeout_ms: 5000
};

/** @type {object} */
let serverLimits = { ...DEFAULTS };

/** @type {object|null} */
let logger = null;

let globalInFlight = 0;
/** @type {Map<string, number>} */
const appInFlight = new Map();

let outboundInFlight = 0;

/**
 * @private
 */
function log() {
  return logger || console;
}

/**
 * @private
 */
function positiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * Merge server limits config onto defaults.
 * @param {object|null|undefined} config
 * @param {object} [logRef]
 */
function initServer(config, logRef) {
  logger = logRef || console;
  const c = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  serverLimits = {
    request_timeout_ms: positiveInt(c.request_timeout_ms, DEFAULTS.request_timeout_ms),
    request_timeout_stream_ms: positiveInt(
      c.request_timeout_stream_ms,
      DEFAULTS.request_timeout_stream_ms
    ),
    stream_idle_timeout_ms: positiveInt(
      c.stream_idle_timeout_ms,
      DEFAULTS.stream_idle_timeout_ms
    ),
    outbound_timeout_ms: positiveInt(c.outbound_timeout_ms, DEFAULTS.outbound_timeout_ms),
    max_concurrent_requests: positiveInt(
      c.max_concurrent_requests,
      DEFAULTS.max_concurrent_requests
    ),
    max_concurrent_requests_per_app: positiveInt(
      c.max_concurrent_requests_per_app,
      DEFAULTS.max_concurrent_requests_per_app
    ),
    max_concurrent_outbound: positiveInt(
      c.max_concurrent_outbound,
      DEFAULTS.max_concurrent_outbound
    ),
    headers_timeout_ms: positiveInt(c.headers_timeout_ms, DEFAULTS.headers_timeout_ms),
    request_timeout_server_ms: positiveInt(
      c.request_timeout_server_ms,
      DEFAULTS.request_timeout_server_ms
    ),
    keep_alive_timeout_ms: positiveInt(c.keep_alive_timeout_ms, DEFAULTS.keep_alive_timeout_ms)
  };
  log().info(
    `[limits] request_timeout_ms=${serverLimits.request_timeout_ms} ` +
      `stream_hard=${serverLimits.request_timeout_stream_ms} stream_idle=${serverLimits.stream_idle_timeout_ms} ` +
      `outbound_timeout_ms=${serverLimits.outbound_timeout_ms} ` +
      `max_concurrent=${serverLimits.max_concurrent_requests}/${serverLimits.max_concurrent_requests_per_app} ` +
      `max_outbound=${serverLimits.max_concurrent_outbound}`
  );
}

/**
 * Effective limits for an app: server ceilings, app may only lower numeric caps/timeouts.
 * @param {object|null} app
 * @returns {object}
 */
function resolveForApp(app) {
  const base = { ...serverLimits };
  const appCfg =
    app &&
    app.config &&
    app.config.limits &&
    typeof app.config.limits === 'object' &&
    !Array.isArray(app.config.limits)
      ? app.config.limits
      : null;
  if (!appCfg) return base;

  const tighten = (key) => {
    if (appCfg[key] == null) return;
    const n = Number(appCfg[key]);
    if (!Number.isFinite(n) || n < 1) return;
    base[key] = Math.min(base[key], Math.floor(n));
  };

  tighten('request_timeout_ms');
  tighten('request_timeout_stream_ms');
  tighten('stream_idle_timeout_ms');
  tighten('outbound_timeout_ms');
  tighten('max_concurrent_requests');
  // per-app concurrent: app key is the app's own cap (still capped by server per-app max)
  if (appCfg.max_concurrent_requests != null) {
    const n = Number(appCfg.max_concurrent_requests);
    if (Number.isFinite(n) && n >= 1) {
      base.max_concurrent_requests_per_app = Math.min(
        base.max_concurrent_requests_per_app,
        Math.floor(n)
      );
    }
  } else if (appCfg.max_concurrent_requests_per_app != null) {
    tighten('max_concurrent_requests_per_app');
  }

  return base;
}

/**
 * Try to admit one in-flight server-script request.
 * @param {string} appName
 * @param {object} app
 * @returns {{ ok: true, token: object } | { ok: false, scope: 'global'|'app', statusCode: number, message: string }}
 */
function tryAcquireRequest(appName, app) {
  const lim = resolveForApp(app);
  const name = appName || (app && app.name) || '_unknown';

  if (globalInFlight >= serverLimits.max_concurrent_requests) {
    log().warn(
      `[limits] Rejecting request for '${name}': global concurrency ${globalInFlight}/${serverLimits.max_concurrent_requests}`
    );
    return {
      ok: false,
      scope: 'global',
      statusCode: 503,
      message: 'TOO_MANY_REQUESTS: server concurrency limit reached'
    };
  }

  const appCount = appInFlight.get(name) || 0;
  if (appCount >= lim.max_concurrent_requests_per_app) {
    log().warn(
      `[limits] Rejecting request for '${name}': app concurrency ${appCount}/${lim.max_concurrent_requests_per_app}`
    );
    return {
      ok: false,
      scope: 'app',
      statusCode: 503,
      message: 'TOO_MANY_REQUESTS: application concurrency limit reached'
    };
  }

  globalInFlight += 1;
  appInFlight.set(name, appCount + 1);

  return {
    ok: true,
    token: {
      appName: name,
      released: false,
      limits: lim
    }
  };
}

/**
 * @param {object|null} token
 */
function releaseRequest(token) {
  if (!token || token.released) return;
  token.released = true;
  globalInFlight = Math.max(0, globalInFlight - 1);
  const cur = appInFlight.get(token.appName) || 0;
  if (cur <= 1) appInFlight.delete(token.appName);
  else appInFlight.set(token.appName, cur - 1);
}

/**
 * Attach AbortSignal + deadline timers to the ALS store for an HTTP script request.
 * Call once when script execution begins (after concurrency acquire).
 * @param {object} store - ALS store
 * @param {object} token - from tryAcquireRequest
 * @param {object} res - Node HTTP ServerResponse
 */
function attachRequestContext(store, token, res) {
  if (!store || !token) return;

  const lim = token.limits || serverLimits;
  const ac = new AbortController();
  const startedAt = Date.now();
  const deadline = startedAt + lim.request_timeout_ms;

  store.limitsConfig = lim;
  store.requestAbortController = ac;
  store.requestAbortSignal = ac.signal;
  store.requestDeadline = deadline;
  store.requestStartedAt = startedAt;
  store._limitsToken = token;
  store._limitsTimers = store._limitsTimers || {};

  const clearTimer = (key) => {
    if (store._limitsTimers[key]) {
      clearTimeout(store._limitsTimers[key]);
      store._limitsTimers[key] = null;
    }
  };

  const failRequest = (reason, statusCode) => {
    if (store._limitsTimedOut) return;
    store._limitsTimedOut = true;
    try {
      if (!ac.signal.aborted) ac.abort(reason);
    } catch (_) {
      try {
        ac.abort();
      } catch (__) {
        /* ignore */
      }
    }

    const $g = store.$g;
    if ($g && $g.isCompleted) return;

    const logger = store.logger || log();
    logger.warn(
      `[limits] Request timeout (${reason}) for app '${store.appName}' path=${store.req && store.req.url}`
    );

    if ($g && $g.isStreaming && store.res && !store.res.writableEnded) {
      try {
        if (typeof $g.response.writeSSE === 'function') {
          $g.response.writeSSE({ type: 'error', error: reason });
        }
        if (typeof $g.response.endStream === 'function') {
          $g.response.endStream();
        } else {
          store.res.end();
        }
      } catch (e) {
        logger.error(`[limits] Error ending stream on timeout: ${e.message}`);
      }
      return;
    }

    if (store.res && !store.res.headersSent) {
      try {
        store.res.writeHead(statusCode || 504, { 'Content-Type': 'application/json' });
        store.res.end(
          JSON.stringify({
            error: 'GATEWAY_TIMEOUT',
            message: reason,
            timeout_ms: lim.request_timeout_ms
          })
        );
      } catch (e) {
        logger.error(`[limits] Error sending timeout response: ${e.message}`);
      }
    } else if (store.res && !store.res.writableEnded) {
      try {
        store.res.end();
      } catch (_) {
        /* ignore */
      }
    }

    if ($g) {
      $g.isCompleted = true;
      $g.isStreaming = false;
    }
  };

  store._limitsFailRequest = failRequest;
  store._limitsClearTimer = clearTimer;

  clearTimer('request');
  store._limitsTimers.request = setTimeout(() => {
    // If already streaming, non-stream budget is replaced by stream timers in onStreamStart.
    if (store.$g && store.$g.isStreaming) return;
    failRequest('request_timeout', 504);
  }, lim.request_timeout_ms);

  // Ensure timers cleared when response finishes.
  if (res && typeof res.on === 'function') {
    const cleanup = () => {
      clearTimer('request');
      clearTimer('streamHard');
      clearTimer('streamIdle');
    };
    res.on('finish', cleanup);
    res.on('close', cleanup);
  }
}

/**
 * Switch from request wall timeout to stream idle + hard cap.
 * @param {object} store
 */
function onStreamStart(store) {
  if (!store || !store.limitsConfig) return;
  const lim = store.limitsConfig;
  const clearTimer = store._limitsClearTimer;
  if (clearTimer) clearTimer('request');

  const fail = store._limitsFailRequest;
  if (!fail) return;

  if (clearTimer) clearTimer('streamHard');
  store._limitsTimers = store._limitsTimers || {};
  store._limitsTimers.streamHard = setTimeout(() => {
    fail('stream_hard_timeout', 504);
  }, lim.request_timeout_stream_ms);

  touchStream(store);
}

/**
 * Reset stream idle timer (call on each write / writeSSE).
 * @param {object} store
 */
function touchStream(store) {
  if (!store || !store.limitsConfig || !store.$g || !store.$g.isStreaming) return;
  if (store.$g.isCompleted || store._limitsTimedOut) return;

  const lim = store.limitsConfig;
  const clearTimer = store._limitsClearTimer;
  const fail = store._limitsFailRequest;
  if (!clearTimer || !fail) return;

  clearTimer('streamIdle');
  store._limitsTimers = store._limitsTimers || {};
  store._limitsTimers.streamIdle = setTimeout(() => {
    fail('stream_idle_timeout', 504);
  }, lim.stream_idle_timeout_ms);
}

/**
 * Clear request/stream timers (response completed normally).
 * @param {object} store
 */
function clearRequestTimers(store) {
  if (!store || !store._limitsClearTimer) return;
  store._limitsClearTimer('request');
  store._limitsClearTimer('streamHard');
  store._limitsClearTimer('streamIdle');
}

/**
 * Remaining ms until request deadline (non-stream). Minimum 1 if still active.
 * @param {object|null} store
 * @returns {number|null}
 */
function remainingRequestMs(store) {
  if (!store || store.requestDeadline == null) return null;
  return Math.max(0, store.requestDeadline - Date.now());
}

/**
 * Resolve axios timeout: options.timeout if set, else platform outbound default;
 * clamped to remaining request budget when available; never above server outbound default
 * unless options.timeout is set (then clamped only by remaining budget).
 * @param {number|undefined} optionsTimeout
 * @param {object|null} store
 * @returns {number}
 */
function resolveOutboundTimeoutMs(optionsTimeout, store) {
  const lim =
    (store && store.limitsConfig) ||
    (store && store.app && resolveForApp(store.app)) ||
    serverLimits;

  // Ceiling: app-tightened outbound, never above server default ceiling.
  const ceiling = Math.min(lim.outbound_timeout_ms, serverLimits.outbound_timeout_ms);

  let base =
    optionsTimeout != null && Number.isFinite(Number(optionsTimeout))
      ? Math.max(1, Math.floor(Number(optionsTimeout)))
      : ceiling;

  base = Math.min(base, ceiling);

  const remaining = remainingRequestMs(store);
  // Clamp to remaining non-stream request budget when applicable.
  if (remaining != null && !(store && store.$g && store.$g.isStreaming)) {
    if (remaining <= 0) return 1;
    base = Math.min(base, remaining);
  }

  return Math.max(1, base);
}

/**
 * @returns {{ ok: true, release: function } | { ok: false, message: string }}
 */
function tryAcquireOutbound() {
  if (outboundInFlight >= serverLimits.max_concurrent_outbound) {
    return {
      ok: false,
      message: 'TOO_MANY_OUTBOUND: server outbound concurrency limit reached'
    };
  }
  outboundInFlight += 1;
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      outboundInFlight = Math.max(0, outboundInFlight - 1);
    }
  };
}

/**
 * Apply Node HTTP server timeout knobs.
 * @param {object} server - Node HTTP Server
 */
function applyServerTimeouts(server) {
  if (!server) return;
  try {
    if (typeof server.headersTimeout !== 'undefined') {
      server.headersTimeout = serverLimits.headers_timeout_ms;
    }
    if (typeof server.requestTimeout !== 'undefined') {
      server.requestTimeout = serverLimits.request_timeout_server_ms;
    }
    if (typeof server.keepAliveTimeout !== 'undefined') {
      server.keepAliveTimeout = serverLimits.keep_alive_timeout_ms;
    }
  } catch (e) {
    log().warn(`[limits] Could not apply server timeouts: ${e.message}`);
  }
}

function getServerLimits() {
  return { ...serverLimits };
}

function getStats() {
  return {
    globalInFlight,
    appInFlight: Object.fromEntries(appInFlight),
    outboundInFlight,
    limits: getServerLimits()
  };
}

/** @private */
function _resetForTests() {
  globalInFlight = 0;
  appInFlight.clear();
  outboundInFlight = 0;
  serverLimits = { ...DEFAULTS };
  logger = null;
}

module.exports = {
  DEFAULTS,
  initServer,
  resolveForApp,
  tryAcquireRequest,
  releaseRequest,
  attachRequestContext,
  onStreamStart,
  touchStream,
  clearRequestTimers,
  remainingRequestMs,
  resolveOutboundTimeoutMs,
  tryAcquireOutbound,
  applyServerTimeouts,
  getServerLimits,
  getStats,
  _resetForTests
};
