/**
 * @module engine/request_context/build_g
 * @description Build store.$g (app meta, request/response helpers, schedule context).
 * Called only from modules/gingee.js. Engine-internal.
 *
 * Behavior must match the pre-extract gingee() middleware exactly.
 */

const path = require("path");
const zlib = require("zlib");
const { URL } = require("url");
const limits = require("../../limits.js");

/** Default raw body size threshold (bytes) for script-response gzip. */
const DEFAULT_GZIP_SIZE_THRESHOLD = 1024;

/**
 * Resolve content_encoding.size_threshold (script `$g.response.send` gzip gate).
 * @param {object|null|undefined} globalConfig
 * @returns {number}
 * @private
 */
function resolveGzipSizeThreshold(globalConfig) {
  const ce =
    globalConfig && globalConfig.content_encoding
      ? globalConfig.content_encoding
      : null;
  if (!ce || typeof ce !== "object") {
    return DEFAULT_GZIP_SIZE_THRESHOLD;
  }
  // Prefer size_threshold; accept legacy min_bytes if present.
  const raw =
    ce.size_threshold != null && ce.size_threshold !== ""
      ? ce.size_threshold
      : ce.min_bytes;
  if (raw == null || raw === "") {
    return DEFAULT_GZIP_SIZE_THRESHOLD;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    return DEFAULT_GZIP_SIZE_THRESHOLD;
  }
  return Math.floor(n);
}

/**
 * Populate store.$g with log, app, limits, and either schedule or HTTP request/response.
 * Does not parse HTTP body — that remains in body.js / gingee().
 *
 * @param {object} store - ALS store
 * @returns {{ isHttpContext: boolean }}
 */
function initializeGContext(store) {
  const isHttpContext = !!(store.req && store.res);

  if (!store.$g) store.$g = {};

  store.$g.log = store.logger;
  store.$g.app = {
    name: store.app.config.name,
    version: store.app.config.version,
    description: store.app.config.description,
    env: store.app.config.env,
  };
  store.$g.request = null;
  store.$g.response = null;
  store.$g.schedule = null;

  // Box-relative path of the script being executed (main handler path is set on the ALS store
  // before default_include + main script run). Used by app middleware for path-based policy.
  if (store.scriptPath && store.app && store.app.appBoxPath) {
    try {
      const pathMod = require('path');
      store.$g.boxRelativeScript = pathMod
        .relative(store.app.appBoxPath, store.scriptPath)
        .split(pathMod.sep)
        .join('/');
    } catch (_) {
      store.$g.boxRelativeScript = null;
    }
  } else {
    store.$g.boxRelativeScript = null;
  }

  /**
   * Redirect a require specifier for the remainder of this request.
   * Requires **module_override** only (no extra grant for the overridden name).
   * Specifiers: protected bare names (e.g. fs), other bare names (e.g. crypto, url),
   * relative paths (./x), or box-root paths (lib/x). Target path must be under the app box.
   * Restricted / engine / forbidden names cannot be overridden.
   * Override target loads with applyModuleOverrides: false (nested require = normal jailing).
   *
   * @param {string} moduleName - require specifier to intercept
   * @param {string} boxRelativePath - replacement script under the app box
   */
  store.$g.overrideModule = function overrideModule(moduleName, boxRelativePath) {
    const granted =
      (store.app && store.app.grantedPermissions) || [];
    if (!granted.includes('module_override')) {
      throw new Error(
        "Security Error: The app has not been granted permission to use module overrides. " +
          "Grant the 'module_override' permission in Glade or settings/permissions.json."
      );
    }
    if (!moduleName || boxRelativePath == null || boxRelativePath === '') {
      throw new Error('overrideModule(moduleName, boxRelativePath) requires both arguments');
    }
    const name = String(moduleName).replace(/\\/g, '/');
    const norm = name.startsWith('node:') ? name.slice(5) : name;
    // Keep in sync with gbox isNonOverridableSpecifier (restricted / engine / host-dangerous).
    // Bare 'fs' is the Gingee module and is overridable; only host forms (node:fs, fs/promises)
    // are blocked — do not treat bare names as node:<name>.
    const blocked = new Set([
      'gingee', 'gbox', 'gdev', 'gapp-start', 'cache_service', 'internal_utils',
      'platform', 'scheduler', 'limits', 'egress', 'secrets', 'metrics', 'audit',
      'child_process', 'cluster', 'worker_threads', 'vm', 'v8', 'module', 'inspector',
      'repl', 'fs/promises', 'node:fs', 'node:fs/promises', 'node:child_process',
      'node:vm', 'node:worker_threads', 'node:module', 'node:inspector'
    ]);
    if (
      blocked.has(name) ||
      blocked.has(norm) ||
      norm === 'engine' ||
      norm.startsWith('engine/')
    ) {
      throw new Error(
        `Security Error: require('${moduleName}') cannot be overridden (restricted or forbidden).`
      );
    }
    if (!store.moduleOverrides) {
      store.moduleOverrides = Object.create(null);
    }
    // Store under the key as provided; gbox also matches resolved box-relative paths.
    store.moduleOverrides[name] = String(boxRelativePath).replace(/\\/g, '/');
  };

  // Platform limits (request budget / abort) when attached by the engine.
  if (store.limitsConfig || store.requestAbortSignal) {
    store.$g.limits = {
      get remainingMs() {
        return limits.remainingRequestMs(store);
      },
      get deadline() {
        return store.requestDeadline || null;
      },
      get signal() {
        return store.requestAbortSignal || null;
      },
      config: store.limitsConfig || null,
    };
  }

  if (store.isPrivileged) {
    store.$g.appNames = store.appNames;
    store.$g.apps = store.allApps;
  }

  // Scheduled job context (no HTTP req/res): synthetic request/response + schedule meta.
  if (store.isSchedule && !isHttpContext) {
    attachScheduleContext(store);
  }

  // Background queue job context
  if (store.isQueue && !isHttpContext) {
    attachQueueContext(store);
  }

  if (isHttpContext) {
    attachHttpContext(store);
  }

  return { isHttpContext };
}

/**
 * @private
 */
function attachScheduleContext(store) {
  const scheduleMeta = store.scheduleMeta || {};
  store.$g.schedule = {
    name: scheduleMeta.name || null,
    cron: scheduleMeta.cron || null,
    timezone: scheduleMeta.timezone || null,
    runId: scheduleMeta.runId || null,
    scheduledAt: scheduleMeta.scheduledAt || null,
    attempt: scheduleMeta.attempt || 1,
    targetType: scheduleMeta.targetType || null,
    path: scheduleMeta.path || null,
  };
  store.$g.request = {
    protocol: "schedule",
    hostname: null,
    method: "SCHEDULE",
    path: scheduleMeta.path || `/schedule/${scheduleMeta.name || "job"}`,
    url: null,
    headers: {},
    cookies: {},
    query: {},
    params: {},
    body: store.schedulePayload !== undefined ? store.schedulePayload : null,
    // Cooperative cancel when schedule times out (M5).
    signal: store.requestAbortSignal || null,
  };
  store.$g.response = {
    status: 200,
    headers: { "Content-Type": "text/plain" },
    cookies: {},
    body: null,
    startStream: () => {
      store.logger.warn(
        "response.startStream() is not supported in schedule context.",
      );
    },
    write: () => {},
    writeSSE: () => {},
    endStream: () => {
      store.$g.isCompleted = true;
      store.$g.isStreaming = false;
    },
    send: (data, status, contentType) => {
      if (store.$g && store.$g.isCompleted) {
        store.logger.warn(
          `response.send() called multiple times in schedule context from '${path.basename(store.scriptPath)}' — ignored.`,
        );
        return;
      }
      store.$g.isCompleted = true;
      store.$g.completedBy = path.basename(store.scriptPath);
      store.$g.scheduleResult = {
        data,
        status: status || 200,
        contentType: contentType || null,
      };
      if (typeof store.logger.debug === "function") {
        store.logger.debug(
          `Schedule job response recorded by: ${store.$g.completedBy}`,
        );
      }
    },
  };
}

/**
 * @private
 */
function attachQueueContext(store) {
  const q = store.queueJob || {};
  store.$g.queue = {
    id: q.id || null,
    name: q.name || null,
    payload: q.payload !== undefined ? q.payload : store.queuePayload,
    attempt: q.attempt || 1,
    maxAttempts: q.maxAttempts || 1,
  };
  store.$g.schedule = null;
  store.$g.request = {
    protocol: "queue",
    hostname: null,
    method: "QUEUE",
    path: q.name ? `/queue/${q.name}` : "/queue",
    url: null,
    headers: {},
    cookies: {},
    query: {},
    params: {},
    body: store.$g.queue.payload,
  };
  store.$g.response = {
    status: 200,
    headers: { "Content-Type": "text/plain" },
    cookies: {},
    body: null,
    startStream: () => {
      store.logger.warn(
        "response.startStream() is not supported in queue context.",
      );
    },
    write: () => {},
    writeSSE: () => {},
    endStream: () => {
      store.$g.isCompleted = true;
      store.$g.isStreaming = false;
    },
    send: (data, status, contentType) => {
      if (store.$g && store.$g.isCompleted) {
        store.logger.warn(
          `response.send() called multiple times in queue context from '${path.basename(store.scriptPath)}' — ignored.`,
        );
        return;
      }
      store.$g.isCompleted = true;
      store.$g.completedBy = path.basename(store.scriptPath);
      store.$g.queueResult = {
        data,
        status: status || 200,
        contentType: contentType || null,
      };
      if (typeof store.logger.debug === "function") {
        store.logger.debug(
          `Queue job response recorded by: ${store.$g.completedBy}`,
        );
      }
    },
  };
}

/**
 * @private
 */
function attachHttpContext(store) {
  const res = store.res;

  const utils = {
    parseCookies: (req) => {
      const list = {};
      const cookieHeader = req.headers?.cookie;

      if (!cookieHeader) return list;

      cookieHeader.split(";").forEach(function (cookie) {
        let [name, ...rest] = cookie.split("=");
        name = name?.trim();
        if (!name) return;

        const value = rest.join("=").trim();
        if (!value) return;

        list[name] = decodeURIComponent(value);
      });

      return list;
    },

    request: (req) => {
      // Direct TLS (socket) or reverse-proxy forwarded proto (first hop)
      const sockEncrypted = !!(
        (req.socket && req.socket.encrypted) ||
        (req.connection && req.connection.encrypted)
      );
      const xf =
        req.headers &&
        (req.headers["x-forwarded-proto"] || req.headers["X-Forwarded-Proto"]);
      const forwardedHttps =
        xf && String(xf).split(",")[0].trim().toLowerCase() === "https";
      const isHttps = sockEncrypted || forwardedHttps;
      const protocol = isHttps ? "https" : "http";
      const fullUrl = new URL(req.url, `${protocol}://${req.headers.host}`);

      return {
        protocol: protocol,
        hostname: req.headers.host,
        method: req.method,
        path: fullUrl.pathname,
        url: fullUrl,
        headers: req.headers,
        cookies: utils.parseCookies(req),
        query: Object.fromEntries(fullUrl.searchParams),
        params: store.routeParams || {},
        body: req.body,
      };
    },

    response: (resInner) => {
      return {
        status: 200,
        headers: {
          "Content-Type": "text/plain",
        },
        cookies: {},
        body: null,

        /**
         * Begin a streamed HTTP response (e.g. SSE for AI chat).
         * After startStream, use write() / writeSSE() and endStream().
         */
        startStream: (status, contentType, extraHeaders) => {
          if (store.$g && store.$g.isCompleted) {
            store.logger.warn(
              `response.startStream() ignored; response already completed.`,
            );
            return;
          }
          if (store.$g && store.$g.isStreaming) {
            store.logger.warn(`response.startStream() called twice.`);
            return;
          }
          store.$g.isStreaming = true;
          store.$g.completedBy = path.basename(store.scriptPath);

          resInner.statusCode = status || 200;

          // Custom headers first, then stream defaults win for Content-Type.
          let headerKeys = Object.keys(response.headers);
          if (headerKeys.length > 0) {
            headerKeys.forEach((key) => {
              if (String(key).toLowerCase() === "content-type") return;
              resInner.setHeader(key, response.headers[key]);
            });
          }
          if (extraHeaders && typeof extraHeaders === "object") {
            Object.keys(extraHeaders).forEach((key) => {
              resInner.setHeader(key, extraHeaders[key]);
            });
          }

          const ct = contentType || "text/event-stream; charset=utf-8";
          resInner.setHeader("Content-Type", ct);
          resInner.setHeader("Cache-Control", "no-cache, no-transform");
          resInner.setHeader("Connection", "keep-alive");
          resInner.setHeader("X-Accel-Buffering", "no");

          let cookieKeys = Object.keys(response.cookies);
          if (cookieKeys.length > 0) {
            var cookieStrings = cookieKeys.map((key) => {
              return `${key}=${response.cookies[key]}`;
            });
            resInner.setHeader("Set-Cookie", cookieStrings);
          }

          if (typeof resInner.flushHeaders === "function") {
            resInner.flushHeaders();
          }

          // Replace short request wall-clock with stream idle + hard cap.
          limits.onStreamStart(store);
        },

        /** Write a raw chunk to an open stream. */
        write: (chunk) => {
          if (!store.$g || !store.$g.isStreaming || store.$g.isCompleted)
            return;
          if (chunk === undefined || chunk === null) return;
          limits.touchStream(store);
          resInner.write(
            typeof chunk === "string" || Buffer.isBuffer(chunk)
              ? chunk
              : String(chunk),
          );
        },

        /**
         * Write one Server-Sent Event data line (JSON-serialized if object).
         */
        writeSSE: (payload) => {
          if (!store.$g || !store.$g.isStreaming || store.$g.isCompleted)
            return;
          limits.touchStream(store);
          const data =
            typeof payload === "string" ? payload : JSON.stringify(payload);
          resInner.write(`data: ${data}\n\n`);
        },

        /** Finish a streamed response. */
        endStream: () => {
          if (!store.$g || store.$g.isCompleted) return;
          store.$g.isCompleted = true;
          store.$g.isStreaming = false;
          limits.clearRequestTimers(store);
          if (typeof store.logger.debug === "function") {
            store.logger.debug(`Stream ended by: ${store.$g.completedBy}`);
          }
          resInner.end();
        },

        send: (data, status, contentType) => {
          if (store.$g && store.$g.isCompleted) {
            store.logger.warn(
              `response.send() called multiple times. Original call from '${store.$g.completedBy}'. New call from '${path.basename(store.scriptPath)}' ignored.`,
            );
            return;
          }
          if (store.$g && store.$g.isStreaming) {
            store.logger.warn(
              `response.send() ignored; stream already started. Use endStream().`,
            );
            return;
          }
          store.$g.isCompleted = true;
          store.$g.completedBy = path.basename(store.scriptPath);
          limits.clearRequestTimers(store);
          if (typeof store.logger.debug === "function") {
            store.logger.debug(`Response sent by: ${store.$g.completedBy}`);
          }

          resInner.statusCode = status || response.status || 200;

          let headerKeys = Object.keys(response.headers);
          if (headerKeys.length > 0) {
            headerKeys.forEach((key) => {
              resInner.setHeader(key, response.headers[key]);
            });
          }

          let cookieKeys = Object.keys(response.cookies);
          if (cookieKeys.length > 0) {
            var cookieStrings = cookieKeys.map((key) => {
              return `${key}=${response.cookies[key]}`;
            });
            resInner.setHeader("Set-Cookie", cookieStrings);
          }

          if (contentType) {
            resInner.setHeader("Content-Type", contentType);
          }

          let payload = data;
          if (payload != null) {
            if (Buffer.isBuffer(payload)) {
              // already binary
            } else if (typeof payload === "object") {
              payload = Buffer.from(JSON.stringify(payload), "utf8");
              if (!contentType) {
                resInner.setHeader("Content-Type", "application/json");
              }
            } else if (typeof payload === "string") {
              payload = Buffer.from(payload, "utf8");
            } else {
              payload = Buffer.from(String(payload), "utf8");
            }
          }

          // Gzip script responses when enabled + client accepts gzip + body ≥ size_threshold.
          // Threshold avoids compressing (and CPU) on every tiny JSON response.
          const gzipSizeThreshold = resolveGzipSizeThreshold(store.globalConfig);
          if (
            payload &&
            payload.length >= gzipSizeThreshold &&
            store.canCompress &&
            !resInner.getHeader("Content-Encoding")
          ) {
            try {
              const compressed = zlib.gzipSync(payload);
              resInner.setHeader("Content-Encoding", "gzip");
              resInner.setHeader("Vary", "Accept-Encoding");
              resInner.setHeader("Content-Length", compressed.length);
              resInner.end(compressed);
              return;
            } catch (e) {
              store.logger.warn(
                `response.send gzip failed; sending uncompressed: ${e.message}`,
              );
            }
          }

          if (payload && Buffer.isBuffer(payload)) {
            resInner.setHeader("Content-Length", payload.length);
            resInner.end(payload);
          } else {
            resInner.end(payload);
          }
        },
      };
    },
  };

  // Preserve cookies set by earlier default_include / middleware gingee() calls
  // (each gingee() rebuilds $g.response; without this Set-Cookie from auth CSRF is lost).
  const priorCookies =
    store.$g &&
    store.$g.response &&
    store.$g.response.cookies &&
    typeof store.$g.response.cookies === "object"
      ? { ...store.$g.response.cookies }
      : {};

  const response = utils.response(res);
  store.$g.request = utils.request(store.req);
  // Cooperative cancel for outbound calls / long work.
  if (store.requestAbortSignal) {
    store.$g.request.signal = store.requestAbortSignal;
  }
  store.$g.response = response;
  if (Object.keys(priorCookies).length > 0) {
    Object.assign(store.$g.response.cookies, priorCookies);
  }
  response.send = response.send.bind(response);
  response.startStream = response.startStream.bind(response);
  response.write = response.write.bind(response);
  response.writeSSE = response.writeSSE.bind(response);
  response.endStream = response.endStream.bind(response);
}

module.exports = {
  initializeGContext,
};
