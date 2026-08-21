/**
 * App worker process entry (forked by worker_manager).
 * Runs sandboxed server scripts for one app or an isolation group.
 *
 * Messages in:
 *   { type: 'init', workerKey, apps: [...], ... }
 *   { type: 'http_script', requestId, appName, ... }
 *   { type: 'shutdown' }
 *
 * Messages out:
 *   { type: 'ready', workerKey }
 *   { type: 'http_result', requestId, ... }           // buffered
 *   { type: 'stream_start'|'stream_chunk'|'stream_end'|'stream_error', requestId, ... }
 *   { type: 'log', level, message }
 */

const path = require("path");
const fs = require("fs");

const engineRoot = path.resolve(__dirname, "..", "..", "..");
require("app-module-path").addPath(path.join(engineRoot, "modules"));

const { isPathInside } = require("../../internal_utils.js");
const { resolveAllowDynamicCodeForApp } = require("../../gbox.js");
const { als } = require("../../gingee.js");
const { createGRequire, runInGBox } = require("../../gbox.js");
const { FakeIncomingMessage, FakeServerResponse } = require("./fake_http.js");
const ai = require("../../ai.js");
const email = require("../../email.js");

/** @type {object|null} */
let workerState = null;

/**
 * In-flight HTTP scripts: requestId → { abortController, cancelled }
 * Master sends `cancel_request` on timeout (M4).
 * @type {Map<string, { abortController: AbortController, cancelled: boolean }>}
 */
const inflight = new Map();

const workerLog = {
  info: (msg) => send({ type: "log", level: "info", message: String(msg) }),
  warn: (msg) => send({ type: "log", level: "warn", message: String(msg) }),
  error: (msg) => send({ type: "log", level: "error", message: String(msg) }),
};

function send(msg) {
  if (typeof process.send === "function") {
    process.send(msg);
  }
}

/**
 * Cooperative cancel for one requestId.
 * @param {string} requestId
 * @param {string} [reason]
 */
function cancelInflight(requestId, reason) {
  const entry = inflight.get(requestId);
  if (!entry) {
    // Register a cancelled placeholder so a race with http_script start still aborts.
    const ac = new AbortController();
    try {
      ac.abort(reason || "cancelled");
    } catch (_) {
      try {
        ac.abort();
      } catch (__) {
        /* ignore */
      }
    }
    inflight.set(requestId, { abortController: ac, cancelled: true });
    return;
  }
  entry.cancelled = true;
  try {
    if (!entry.abortController.signal.aborted) {
      entry.abortController.abort(reason || "cancelled");
    }
  } catch (_) {
    try {
      entry.abortController.abort();
    } catch (__) {
      /* ignore */
    }
  }
}

function isCancelled(requestId) {
  const entry = inflight.get(requestId);
  return !!(entry && entry.cancelled);
}

function ensureInit() {
  if (!workerState || !workerState.apps) {
    throw new Error("Worker not initialized");
  }
}

/**
 * @param {object} msg
 */
async function runHttpScript(msg) {
  ensureInit();
  const appName = msg.appName;
  const appEntry = workerState.apps.get(appName);
  if (!appEntry) {
    throw new Error(`App '${appName}' is not loaded in this worker`);
  }

  const { app, appBoxPath } = appEntry;
  const {
    globalConfig,
    privilegedApps,
    allowedBuiltinModules,
    projectRoot,
    webPath,
  } = workerState;

  const scriptPath = path.resolve(msg.scriptPath);
  if (!isPathInside(scriptPath, appBoxPath)) {
    throw new Error(
      `Security Error: script path outside app box: ${scriptPath}`,
    );
  }
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script not found: ${scriptPath}`);
  }

  const body = msg.bodyBase64
    ? Buffer.from(msg.bodyBase64, "base64")
    : Buffer.alloc(0);
  const requestId = msg.requestId;

  // Reuse abort controller if cancel arrived before script start; else create new.
  let inflightEntry = inflight.get(requestId);
  if (!inflightEntry) {
    inflightEntry = {
      abortController: new AbortController(),
      cancelled: false,
    };
    inflight.set(requestId, inflightEntry);
  }
  const abortController = inflightEntry.abortController;
  const timeoutMs =
    msg.timeoutMs != null && Number.isFinite(Number(msg.timeoutMs))
      ? Math.max(1000, Math.floor(Number(msg.timeoutMs)))
      : 120000;

  const req = new FakeIncomingMessage({
    method: msg.method || "GET",
    url: msg.url || "/",
    headers: msg.headers || {},
    body,
  });

  let streamMode = false;
  const res = new FakeServerResponse({
    onStreamStart: (statusCode, headers) => {
      if (isCancelled(requestId)) return;
      streamMode = true;
      send({
        type: "stream_start",
        requestId,
        statusCode,
        headers: headers || {},
      });
    },
    onStreamChunk: (buf) => {
      if (isCancelled(requestId)) return;
      send({
        type: "stream_chunk",
        requestId,
        dataBase64: buf.toString("base64"),
      });
    },
    onStreamEnd: () => {
      if (isCancelled(requestId)) return;
      send({ type: "stream_end", requestId });
    },
  });

  const gBoxConfig = {
    appName: app.name,
    app,
    appBoxPath,
    globalModulesPath: path.join(engineRoot, "modules"),
    localModulesPaths:
      (globalConfig &&
        globalConfig.box &&
        globalConfig.box.localModulesPaths) ||
      [],
    allowedBuiltinModules: allowedBuiltinModules || [],
    privilegedApps: privilegedApps || [],
    useCache: msg.useCache !== false,
    logger: workerLog,
    globalConfig,
    // Per-app: server floor + app.json allow_dynamic_code
    allowDynamicCode: resolveAllowDynamicCodeForApp(
      globalConfig && globalConfig.box,
      app.config,
    ),
  };

  // Build allApps view from worker members (for privileged cross-app — workers are never privileged)
  const allApps = {};
  for (const [n, e] of workerState.apps) {
    allApps[n] = e.app;
  }

  const acceptEncoding =
    (req && req.headers && req.headers["accept-encoding"]) || "";
  const canCompress =
    !!(globalConfig &&
      globalConfig.content_encoding &&
      globalConfig.content_encoding.enabled) &&
    String(acceptEncoding).includes("gzip");

  const store = {
    globalConfig,
    req,
    res,
    projectRoot,
    webPath,
    appName: app.name,
    isPrivileged: false,
    app,
    allApps,
    appNames: Object.keys(allApps),
    logger: workerLog,
    routeParams: msg.routeParams || {},
    scriptPath,
    scriptFolder: path.dirname(scriptPath),
    staticFileCache: null,
    transpileCache: null,
    maxBodySize: msg.maxBodySize || "25mb",
    canCompress,
    // Cooperative cancel for httpclient / long work (M4)
    requestAbortController: abortController,
    requestAbortSignal: abortController.signal,
    requestDeadline: Date.now() + timeoutMs,
    requestStartedAt: Date.now(),
  };

  try {
    if (isCancelled(requestId)) {
      return;
    }

    await als.run(store, async () => {
      if (isCancelled(requestId) || abortController.signal.aborted) {
        return;
      }

      if (app.config.default_include) {
        const gRequire = createGRequire(scriptPath, gBoxConfig);
        for (const includedPath of app.config.default_include) {
          let includeScript = gRequire(includedPath);
          if (typeof includeScript === "function") {
            includeScript = await includeScript();
          }
          const includeStore = als.getStore();
          if (includeStore && includeStore.$g && includeStore.$g.isCompleted) {
            return;
          }
          if (isCancelled(requestId) || abortController.signal.aborted) {
            return;
          }
        }
      }

      const script = runInGBox(scriptPath, gBoxConfig);
      if (typeof script === "function") {
        await script();
      } else {
        throw new Error(`Script ${scriptPath} did not export a function.`);
      }

      // Scripts that call `gingee(...)` without await can return before $g.response
      // finishes (common with async AI). Wait for send/endStream, cancel, or timeout.
      const storeNow = als.getStore();
      if (
        storeNow &&
        storeNow.$g &&
        !storeNow.$g.isCompleted &&
        !res.writableEnded &&
        !isCancelled(requestId) &&
        !abortController.signal.aborted
      ) {
        await waitForResponseSettle(
          res,
          storeNow,
          timeoutMs,
          abortController.signal,
        );
      }
    });

    // Drop result if master already cancelled/timed out (M4).
    if (isCancelled(requestId) || abortController.signal.aborted) {
      workerLog.info(
        `[worker] Request ${requestId} cancelled; suppressing result`,
      );
      return;
    }

    // Buffered path: single http_result (stream already sent frames)
    if (!streamMode) {
      const result = res.toResult();
      send({
        type: "http_result",
        requestId,
        statusCode: result.statusCode,
        headers: result.headers,
        bodyBase64: result.body.toString("base64"),
      });
    } else if (!res.writableEnded) {
      // Stream started but never ended — close it
      send({ type: "stream_end", requestId });
    }
  } finally {
    inflight.delete(requestId);
  }
}

/**
 * Wait until response is completed/ended, aborted, or timeout.
 * Covers fire-and-forget `gingee(...)` without await.
 * @param {object} res
 * @param {object} store
 * @param {number} maxMs
 * @param {AbortSignal} [signal]
 */
function waitForResponseSettle(res, store, maxMs, signal) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      clearTimeout(timeout);
      if (signal && typeof signal.removeEventListener === "function") {
        try {
          signal.removeEventListener("abort", onAbort);
        } catch (_) {
          /* ignore */
        }
      }
      resolve();
    };
    const onAbort = () => done();
    const timeout = setTimeout(done, maxMs);
    const timer = setInterval(() => {
      if (res.writableEnded || (store.$g && store.$g.isCompleted)) done();
      if (signal && signal.aborted) done();
    }, 10);
    if (typeof res.once === "function") {
      res.once("finish", done);
      res.once("close", done);
    }
    if (signal) {
      if (signal.aborted) {
        done();
        return;
      }
      if (typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    }
  });
}

process.on("message", async (msg) => {
  if (!msg || typeof msg !== "object") return;

  try {
    if (msg.type === "init") {
      const appsMap = new Map();
      const list = Array.isArray(msg.apps) ? msg.apps : [];
      // Back-compat: single-app init shape
      if (list.length === 0 && msg.appName) {
        list.push({
          appName: msg.appName,
          appWebPath: msg.appWebPath,
          appBoxPath: msg.appBoxPath,
          appConfig: msg.appConfig,
          grantedPermissions: msg.grantedPermissions,
        });
      }

      const globalConfig = msg.globalConfig || {};

      // Master already ran ai/email init; this child process has empty in-memory maps.
      // Re-init from server defaults + each app's app.json snapshot (includes resolved secrets).
      try {
        ai.initServer(globalConfig.ai || null, workerLog);
      } catch (e) {
        workerLog.error(`[worker] ai.initServer failed: ${e.message}`);
      }
      try {
        email.initServer(globalConfig.email || null, workerLog);
      } catch (e) {
        workerLog.error(`[worker] email.initServer failed: ${e.message}`);
      }

      for (const entry of list) {
        const name = entry.appName;
        const app = {
          name,
          config: entry.appConfig || {},
          appWebPath: entry.appWebPath,
          appBoxPath: entry.appBoxPath,
          logger: workerLog,
          grantedPermissions: entry.grantedPermissions || [],
          in_maintenance: false,
        };
        appsMap.set(name, {
          appBoxPath: entry.appBoxPath,
          app,
        });
        try {
          ai.initApp(app, workerLog);
        } catch (e) {
          workerLog.error(
            `[worker] ai.initApp('${name}') failed: ${e.message}`,
          );
        }
        try {
          email.initApp(app, workerLog);
        } catch (e) {
          workerLog.error(
            `[worker] email.initApp('${name}') failed: ${e.message}`,
          );
        }
      }

      workerState = {
        workerKey:
          msg.workerKey || (list[0] && `app:${list[0].appName}`) || "unknown",
        projectRoot: msg.projectRoot,
        webPath: msg.webPath,
        globalConfig,
        privilegedApps: msg.privilegedApps || [],
        allowedBuiltinModules: msg.allowedBuiltinModules || [],
        allowDynamicCode:
          msg.allowDynamicCode !== false && msg.allowCodeGeneration !== false,
        apps: appsMap,
      };
      send({
        type: "ready",
        workerKey: workerState.workerKey,
        apps: [...appsMap.keys()],
      });
      return;
    }

    if (msg.type === "shutdown") {
      process.exit(0);
      return;
    }

    if (msg.type === "cancel_request" && msg.requestId) {
      workerLog.info(
        `[worker] cancel_request ${msg.requestId}${msg.reason ? `: ${msg.reason}` : ""}`,
      );
      cancelInflight(msg.requestId, msg.reason || "cancelled by master");
      return;
    }

    if (msg.type === "http_script") {
      try {
        await runHttpScript(msg);
      } catch (err) {
        // Suppress error IPC when master already cancelled (timeout).
        if (isCancelled(msg.requestId)) {
          inflight.delete(msg.requestId);
          return;
        }
        send({
          type: "stream_error",
          requestId: msg.requestId,
          error: err.message || String(err),
        });
        send({
          type: "http_result",
          requestId: msg.requestId,
          statusCode: 500,
          headers: { "content-type": "text/plain" },
          bodyBase64: Buffer.from(
            `INTERNAL_SERVER_ERROR - ${err.message || String(err)}`,
            "utf8",
          ).toString("base64"),
          error: err.message || String(err),
        });
        inflight.delete(msg.requestId);
      }
      return;
    }
  } catch (err) {
    send({
      type: "log",
      level: "error",
      message: `Worker message handler failed: ${err.message}`,
    });
    if (msg.type === "http_script" && msg.requestId) {
      send({
        type: "http_result",
        requestId: msg.requestId,
        statusCode: 500,
        headers: { "content-type": "text/plain" },
        bodyBase64: Buffer.from(
          `INTERNAL_SERVER_ERROR - ${err.message}`,
          "utf8",
        ).toString("base64"),
        error: err.message,
      });
    }
  }
});

process.on("disconnect", () => {
  process.exit(0);
});
