/**
 * @module engine/request_context/build_g
 * @description Build store.$g (app meta, request/response helpers, schedule context).
 * Called only from modules/gingee.js. Engine-internal.
 *
 * Behavior must match the pre-extract gingee() middleware exactly.
 */

const path = require('path');
const { URL } = require('url');
const limits = require('../../limits.js');

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
    env: store.app.config.env
  };
  store.$g.request = null;
  store.$g.response = null;
  store.$g.schedule = null;

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
      config: store.limitsConfig || null
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
    path: scheduleMeta.path || null
  };
  store.$g.request = {
    protocol: 'schedule',
    hostname: null,
    method: 'SCHEDULE',
    path: scheduleMeta.path || `/schedule/${scheduleMeta.name || 'job'}`,
    url: null,
    headers: {},
    cookies: {},
    query: {},
    params: {},
    body: store.schedulePayload !== undefined ? store.schedulePayload : null
  };
  store.$g.response = {
    status: 200,
    headers: { 'Content-Type': 'text/plain' },
    cookies: {},
    body: null,
    startStream: () => {
      store.logger.warn('response.startStream() is not supported in schedule context.');
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
          `response.send() called multiple times in schedule context from '${path.basename(store.scriptPath)}' — ignored.`
        );
        return;
      }
      store.$g.isCompleted = true;
      store.$g.completedBy = path.basename(store.scriptPath);
      store.$g.scheduleResult = {
        data,
        status: status || 200,
        contentType: contentType || null
      };
      store.logger.info(`Schedule job response recorded by: ${store.$g.completedBy}`);
    }
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

      cookieHeader.split(';').forEach(function (cookie) {
        let [name, ...rest] = cookie.split('=');
        name = name?.trim();
        if (!name) return;

        const value = rest.join('=').trim();
        if (!value) return;

        list[name] = decodeURIComponent(value);
      });

      return list;
    },

    request: (req) => {
      const isHttps = req.connection.encrypted;
      const protocol = isHttps ? 'https' : 'http';
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
        body: req.body
      };
    },

    response: (resInner) => {
      return {
        status: 200,
        headers: {
          'Content-Type': 'text/plain'
        },
        cookies: {},
        body: null,

        /**
         * Begin a streamed HTTP response (e.g. SSE for AI chat).
         * After startStream, use write() / writeSSE() and endStream().
         */
        startStream: (status, contentType, extraHeaders) => {
          if (store.$g && store.$g.isCompleted) {
            store.logger.warn(`response.startStream() ignored; response already completed.`);
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
              if (String(key).toLowerCase() === 'content-type') return;
              resInner.setHeader(key, response.headers[key]);
            });
          }
          if (extraHeaders && typeof extraHeaders === 'object') {
            Object.keys(extraHeaders).forEach((key) => {
              resInner.setHeader(key, extraHeaders[key]);
            });
          }

          const ct = contentType || 'text/event-stream; charset=utf-8';
          resInner.setHeader('Content-Type', ct);
          resInner.setHeader('Cache-Control', 'no-cache, no-transform');
          resInner.setHeader('Connection', 'keep-alive');
          resInner.setHeader('X-Accel-Buffering', 'no');

          let cookieKeys = Object.keys(response.cookies);
          if (cookieKeys.length > 0) {
            var cookieStrings = cookieKeys.map((key) => {
              return `${key}=${response.cookies[key]}`;
            });
            resInner.setHeader('Set-Cookie', cookieStrings);
          }

          if (typeof resInner.flushHeaders === 'function') {
            resInner.flushHeaders();
          }

          // Replace short request wall-clock with stream idle + hard cap.
          limits.onStreamStart(store);
        },

        /** Write a raw chunk to an open stream. */
        write: (chunk) => {
          if (!store.$g || !store.$g.isStreaming || store.$g.isCompleted) return;
          if (chunk === undefined || chunk === null) return;
          limits.touchStream(store);
          resInner.write(
            typeof chunk === 'string' || Buffer.isBuffer(chunk) ? chunk : String(chunk)
          );
        },

        /**
         * Write one Server-Sent Event data line (JSON-serialized if object).
         */
        writeSSE: (payload) => {
          if (!store.$g || !store.$g.isStreaming || store.$g.isCompleted) return;
          limits.touchStream(store);
          const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
          resInner.write(`data: ${data}\n\n`);
        },

        /** Finish a streamed response. */
        endStream: () => {
          if (!store.$g || store.$g.isCompleted) return;
          store.$g.isCompleted = true;
          store.$g.isStreaming = false;
          limits.clearRequestTimers(store);
          store.logger.info(`Stream ended by: ${store.$g.completedBy}`);
          resInner.end();
        },

        send: (data, status, contentType) => {
          if (store.$g && store.$g.isCompleted) {
            store.logger.warn(
              `response.send() called multiple times. Original call from '${store.$g.completedBy}'. New call from '${path.basename(store.scriptPath)}' ignored.`
            );
            return;
          }
          if (store.$g && store.$g.isStreaming) {
            store.logger.warn(`response.send() ignored; stream already started. Use endStream().`);
            return;
          }
          store.$g.isCompleted = true;
          store.$g.completedBy = path.basename(store.scriptPath);
          limits.clearRequestTimers(store);
          store.logger.info(`Response sent by: ${store.$g.completedBy}`);

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
            resInner.setHeader('Set-Cookie', cookieStrings);
          }

          if (contentType) {
            resInner.setHeader('Content-Type', contentType);
          }

          if (data) {
            if (Buffer.isBuffer(data)) {
              resInner.setHeader('Content-Length', data.length);
            } else if (typeof data === 'object') {
              data = JSON.stringify(data);
              resInner.setHeader('Content-Type', 'application/json');
            }
          }
          resInner.end(data);
        }
      };
    }
  };

  const response = utils.response(res);
  store.$g.request = utils.request(store.req);
  // Cooperative cancel for outbound calls / long work.
  if (store.requestAbortSignal) {
    store.$g.request.signal = store.requestAbortSignal;
  }
  store.$g.response = response;
  response.send = response.send.bind(response);
  response.startStream = response.startStream.bind(response);
  response.write = response.write.bind(response);
  response.writeSSE = response.writeSSE.bind(response);
  response.endStream = response.endStream.bind(response);
}

module.exports = {
  initializeGContext
};
