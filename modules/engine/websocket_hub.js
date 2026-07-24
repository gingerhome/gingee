/**
 * @module engine/websocket_hub
 * @description Master-owned WebSocket upgrade routing, rooms, and per-app handlers.
 * Engine-internal — not for sandboxed app require.
 *
 * Public apps use require('websockets') which talks to this hub via getContext().
 */

const path = require('path');
const { URL } = require('url');
const { WebSocketServer, WebSocket } = require('ws');
const { als } = require('../gingee.js');
const { runInGBox } = require('../gbox.js');
const { isPathInside } = require('../internal_utils.js');
const metrics = require('../metrics.js');

const engineRoot = path.resolve(__dirname, '..', '..');

/** @type {object} */
const DEFAULTS = {
  enabled: true,
  max_connections: 10000,
  max_connections_per_app: 2000,
  max_message_bytes: 65536,
  idle_timeout_ms: 300000,
  heartbeat_ms: 30000,
  /** Default relative path under /{appName} when app omits websockets.path */
  default_path: '/ws'
};

/**
 * Process-wide singleton state so sandbox require() and engine require()
 * always share the same connection/room maps (avoids duplicate module instances).
 */
const STATE_KEY = Symbol.for('gingee.websocket.hub.state');
const ACTIVE_APP_KEY = Symbol.for('gingee.websocket.activeApp');

function state() {
  if (!globalThis[STATE_KEY]) {
    globalThis[STATE_KEY] = {
      serverConfig: { ...DEFAULTS },
      serverLogger: null,
      globalConfigRef: null,
      appsRegistry: null,
      wss: null,
      bindings: new Map(),
      sockets: new Map(),
      rooms: new Map(),
      appConnCounts: new Map(),
      nextSocketId: 1,
      heartbeatTimer: null
    };
  }
  return globalThis[STATE_KEY];
}

function log() {
  return state().serverLogger || console;
}

function positiveInt(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

/**
 * @param {object|null|undefined} cfg
 * @param {object} logger
 * @param {object} [globalConfig]
 */
function initServer(cfg, logger, globalConfig) {
  const S = state();
  S.serverLogger = logger || console;
  S.globalConfigRef = globalConfig || null;
  const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  S.serverConfig = {
    enabled: c.enabled !== false,
    max_connections: positiveInt(c.max_connections, DEFAULTS.max_connections),
    max_connections_per_app: positiveInt(
      c.max_connections_per_app,
      DEFAULTS.max_connections_per_app
    ),
    max_message_bytes: positiveInt(c.max_message_bytes, DEFAULTS.max_message_bytes),
    idle_timeout_ms: positiveInt(c.idle_timeout_ms, DEFAULTS.idle_timeout_ms),
    heartbeat_ms: positiveInt(c.heartbeat_ms, DEFAULTS.heartbeat_ms),
    default_path: typeof c.default_path === 'string' && c.default_path
      ? normalizePath(c.default_path)
      : DEFAULTS.default_path
  };

  if (!S.serverConfig.enabled) {
    log().info('[websockets] Disabled (websockets.enabled is false).');
    return;
  }

  if (!S.wss) {
    S.wss = new WebSocketServer({
      noServer: true,
      maxPayload: S.serverConfig.max_message_bytes
    });
    S.wss.on('connection', onConnection);
  }

  startHeartbeat();
  log().info(
    `[websockets] enabled max_connections=${S.serverConfig.max_connections} max_per_app=${S.serverConfig.max_connections_per_app}`
  );
}

/**
 * @param {object|null} apps
 */
function setAppsRegistry(apps) {
  const S = state();
  S.appsRegistry = apps || null;
}

function normalizePath(p) {
  const S = state();
  let s = String(p || '/ws').trim();
  if (!s.startsWith('/')) s = `/${s}`;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

/**
 * Full public path for an app binding: /{appName}{relativePath}
 * @param {string} appName
 * @param {string} relativePath
 */
function fullPathFor(appName, relativePath) {
  const S = state();
  return `/${appName}${normalizePath(relativePath)}`;
}

/**
 * Parse upgrade URL into app name + remainder path.
 * @param {string} url
 * @returns {{ appName: string, restPath: string, pathname: string, searchParams: URLSearchParams }|null}
 */
function parseUpgradeUrl(url) {
  const S = state();
  try {
    const u = new URL(url, 'http://localhost');
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const appName = parts[0];
    const restPath = normalizePath('/' + parts.slice(1).join('/'));
    return {
      appName,
      restPath,
      pathname: u.pathname,
      searchParams: u.searchParams
    };
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} app
 * @param {object} [globalConfig]
 */
async function registerApp(app, globalConfig) {
  const S = state();
  if (!S.serverConfig.enabled || !S.wss) return false;
  if (!app || !app.name) return false;

  const cfg = globalConfig || S.globalConfigRef || {};
  unregisterApp(app.name, { silent: true });

  const wsCfg = app.config && app.config.websockets;
  if (!wsCfg || wsCfg.enabled === false) {
    return false;
  }
  // enabled omitted or true when websockets object present with handler
  if (wsCfg.enabled !== true && !wsCfg.handler) {
    return false;
  }

  const granted = app.grantedPermissions || [];
  if (!granted.includes('websockets')) {
    log().warn(
      `[websockets] App '${app.name}' has websockets config but no "websockets" permission; not registering.`
    );
    return false;
  }

  const relPath = normalizePath(wsCfg.path || S.serverConfig.default_path);
  const handlerRel = wsCfg.handler != null ? String(wsCfg.handler).trim() : '';
  if (!handlerRel) {
    log().warn(`[websockets] App '${app.name}' websockets.handler is missing; not registering.`);
    return false;
  }

  const handlerPath = path.resolve(app.appBoxPath, handlerRel);
  if (!isPathInside(handlerPath, app.appBoxPath) || !require('fs').existsSync(handlerPath)) {
    log().error(
      `[websockets] App '${app.name}' handler not found or outside box: ${handlerRel}`
    );
    return false;
  }

  let authPath = null;
  if (wsCfg.auth) {
    authPath = path.resolve(app.appBoxPath, String(wsCfg.auth).trim());
    if (!isPathInside(authPath, app.appBoxPath) || !require('fs').existsSync(authPath)) {
      log().error(`[websockets] App '${app.name}' auth script not found or outside box: ${wsCfg.auth}`);
      return false;
    }
  }

  const gBoxConfig = {
    appName: app.name,
    app,
    appBoxPath: app.appBoxPath,
    globalModulesPath: path.join(engineRoot, 'modules'),
    allowedBuiltinModules: (cfg.box && cfg.box.allowed_modules) || [],
    privilegedApps: cfg.privileged_apps || [],
    useCache: true,
    logger: app.logger || log(),
    globalConfig: cfg,
    allowCodeGeneration: !cfg.box || cfg.box.allow_code_generation !== false
  };

  let handlerFn;
  let authFn = null;
  try {
    await als.run(
      {
        appName: app.name,
        app,
        logger: app.logger || log(),
        globalConfig: cfg,
        scriptPath: handlerPath,
        scriptFolder: path.dirname(handlerPath)
      },
      async () => {
        const mod = runInGBox(handlerPath, gBoxConfig);
        if (typeof mod !== 'function') {
          throw new Error('WebSocket handler must export a function');
        }
        handlerFn = mod;
        if (authPath) {
          const amod = runInGBox(authPath, {
            ...gBoxConfig,
            // auth uses same box config
          });
          if (typeof amod !== 'function') {
            throw new Error('WebSocket auth must export a function');
          }
          authFn = amod;
        }
      }
    );
  } catch (e) {
    log().error(`[websockets] Failed to load handler for '${app.name}': ${e.message}`);
    return false;
  }

  const allowedOrigins = Array.isArray(wsCfg.allowed_origins)
    ? wsCfg.allowed_origins.map(String)
    : null;

  S.bindings.set(app.name, {
    app,
    path: relPath,
    fullPath: fullPathFor(app.name, relPath),
    handlerFn,
    authFn,
    handlerPath,
    authPath,
    allowedOrigins,
    gBoxConfig
  });

  if (!S.rooms.has(app.name)) S.rooms.set(app.name, new Map());
  S.appConnCounts.set(app.name, S.appConnCounts.get(app.name) || 0);

  log().info(
    `[websockets] Registered app '${app.name}' at ${fullPathFor(app.name, relPath)}`
  );
  return true;
}

/**
 * @param {string} appName
 * @param {object} [opts]
 */
function unregisterApp(appName, opts = {}) {
  const S = state();
  const binding = S.bindings.get(appName);
  if (!binding && !opts.silent) {
    return;
  }
  S.bindings.delete(appName);

  // Close all S.sockets for this app
  for (const [id, entry] of [...S.sockets.entries()]) {
    if (entry.appName === appName) {
      try {
        entry.ws.close(1001, 'app unloaded');
      } catch (_) {
        /* ignore */
      }
      removeSocket(id);
    }
  }
  S.rooms.delete(appName);
  S.appConnCounts.delete(appName);
  if (!opts.silent) {
    log().info(`[websockets] Unregistered app '${appName}'`);
  }
}

/**
 * Attach upgrade listener to an http.Server / https.Server.
 * @param {object} server - Node http.Server or https.Server
 */
function attachServer(server) {
  const S = state();
  if (!S.serverConfig.enabled || !S.wss || !server) return;

  server.on('upgrade', (req, socket, head) => {
    handleUpgrade(req, socket, head).catch((err) => {
      log().error(`[websockets] upgrade error: ${err.message}`);
      try {
        socket.destroy();
      } catch (_) {
        /* ignore */
      }
    });
  });
}

/**
 * @param {object} req - IncomingMessage
 * @param {object} socket - net.Socket / Duplex
 * @param {Buffer} head
 */
async function handleUpgrade(req, socket, head) {
  const S = state();
  if (!S.serverConfig.enabled || !S.wss) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }

  const parsed = parseUpgradeUrl(req.url || '/');
  if (!parsed) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    metrics.inc('gingee_websocket_upgrades_total', { result: 'not_found' });
    return;
  }

  const binding = S.bindings.get(parsed.appName);
  if (!binding || binding.path !== parsed.restPath) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    metrics.inc('gingee_websocket_upgrades_total', { result: 'not_found' });
    return;
  }

  const app = (S.appsRegistry && S.appsRegistry[parsed.appName]) || binding.app;
  if (!app || app.in_maintenance) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    metrics.inc('gingee_websocket_upgrades_total', { result: 'unavailable' });
    return;
  }

  // Connection limits
  if (S.sockets.size >= S.serverConfig.max_connections) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    metrics.inc('gingee_websocket_upgrades_total', { result: 'limit_global' });
    return;
  }
  const appCount = S.appConnCounts.get(parsed.appName) || 0;
  if (appCount >= S.serverConfig.max_connections_per_app) {
    socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
    socket.destroy();
    metrics.inc('gingee_websocket_upgrades_total', { result: 'limit_app' });
    return;
  }

  // Origin check (optional)
  if (binding.allowedOrigins && binding.allowedOrigins.length > 0) {
    const origin = req.headers.origin;
    if (!origin || !binding.allowedOrigins.includes(origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      metrics.inc('gingee_websocket_upgrades_total', { result: 'origin' });
      return;
    }
  }

  let authMeta = {};
  if (binding.authFn) {
    try {
      const authResult = await als.run(
        {
          appName: app.name,
          app,
          logger: app.logger || log(),
          globalConfig: S.globalConfigRef,
          scriptPath: binding.authPath,
          scriptFolder: binding.authPath ? path.dirname(binding.authPath) : app.appBoxPath,
          isWebSocket: true
        },
        async () =>
          binding.authFn({
            req,
            app,
            headers: req.headers,
            url: req.url,
            query: Object.fromEntries(parsed.searchParams.entries()),
            path: parsed.pathname
          })
      );

      if (authResult === false || authResult == null) {
        socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        socket.destroy();
        metrics.inc('gingee_websocket_upgrades_total', { result: 'auth' });
        return;
      }
      if (typeof authResult === 'object') {
        if (authResult.ok === false) {
          const code = authResult.statusCode || 401;
          socket.write(`HTTP/1.1 ${code} Unauthorized\r\nConnection: close\r\n\r\n`);
          socket.destroy();
          metrics.inc('gingee_websocket_upgrades_total', { result: 'auth' });
          return;
        }
        authMeta = { ...authResult };
        delete authMeta.ok;
      }
    } catch (e) {
      log().error(`[websockets] auth failed for '${app.name}': ${e.message}`);
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      metrics.inc('gingee_websocket_upgrades_total', { result: 'auth_error' });
      return;
    }
  }

  S.wss.handleUpgrade(req, socket, head, (ws) => {
    ws.__gingee = {
      appName: parsed.appName,
      query: Object.fromEntries(parsed.searchParams.entries()),
      pathname: parsed.pathname,
      restPath: parsed.restPath,
      headers: req.headers,
      meta: authMeta,
      remoteAddress: req.socket && req.socket.remoteAddress
    };
    S.wss.emit('connection', ws, req);
  });
}

/**
 * @param {object} ws - ws WebSocket instance
 * @param {object} req - IncomingMessage
 */
function onConnection(ws, req) {
  const S = state();
  const info = ws.__gingee;
  if (!info) {
    ws.close();
    return;
  }

  const appName = info.appName;
  const binding = S.bindings.get(appName);
  const app = (S.appsRegistry && S.appsRegistry[appName]) || (binding && binding.app);
  if (!binding || !app) {
    ws.close();
    return;
  }

  const id = `ws-${S.nextSocketId++}`;
  const entry = {
    id,
    ws,
    appName,
    rooms: new Set(),
    meta: info.meta || {},
    lastActivity: Date.now(),
    facade: null
  };

  const facade = createFacade(entry);
  entry.facade = facade;
  S.sockets.set(id, entry);
  S.appConnCounts.set(appName, (S.appConnCounts.get(appName) || 0) + 1);
  updateGauges();

  metrics.inc('gingee_websocket_upgrades_total', { result: 'ok', app: appName });
  metrics.inc('gingee_websocket_connections_opened_total', { app: appName });

  const runInAppAls = (fn) => {
    const store = {
      appName: app.name,
      app,
      logger: app.logger || log(),
      globalConfig: S.globalConfigRef,
      scriptPath: binding.handlerPath,
      scriptFolder: path.dirname(binding.handlerPath),
      isWebSocket: true,
      websocket: facade
    };
    const prev = globalThis[ACTIVE_APP_KEY];
    globalThis[ACTIVE_APP_KEY] = app.name;
    try {
      return als.run(store, fn);
    } finally {
      globalThis[ACTIVE_APP_KEY] = prev;
    }
  };

  ws.on('message', (data, isBinary) => {
    entry.lastActivity = Date.now();
    if (Buffer.isBuffer(data) && data.length > S.serverConfig.max_message_bytes) {
      try {
        ws.close(1009, 'message too large');
      } catch (_) {
        /* ignore */
      }
      return;
    }
    let payload = data;
    if (!isBinary) {
      payload = Buffer.isBuffer(data) ? data.toString('utf8') : String(data);
    }
    // Keep app context so require('websockets') / db / etc. work inside message handlers
    try {
      runInAppAls(() => facade._emit('message', payload, isBinary));
    } catch (err) {
      log().error(`[websockets] message handler error: ${err.message}`);
    }
  });

  ws.on('pong', () => {
    entry.lastActivity = Date.now();
  });

  ws.on('close', () => {
    removeSocket(id);
    metrics.inc('gingee_websocket_connections_closed_total', { app: appName });
    try {
      runInAppAls(() => facade._emit('close'));
    } catch (_) {
      /* ignore */
    }
  });

  ws.on('error', (err) => {
    log().warn(`[websockets] socket error app=${appName}: ${err.message}`);
  });

  const ctx = {
    app,
    log: app.logger || log(),
    query: info.query,
    path: info.pathname,
    headers: info.headers,
    meta: entry.meta,
    remoteAddress: info.remoteAddress
  };

  const runHandler = async () => {
    const prev = globalThis[ACTIVE_APP_KEY];
    globalThis[ACTIVE_APP_KEY] = app.name;
    try {
      await als.run(
        {
          appName: app.name,
          app,
          logger: app.logger || log(),
          globalConfig: S.globalConfigRef,
          scriptPath: binding.handlerPath,
          scriptFolder: path.dirname(binding.handlerPath),
          isWebSocket: true,
          websocket: facade
        },
        async () => {
          await binding.handlerFn(facade, ctx);
        }
      );
    } finally {
      globalThis[ACTIVE_APP_KEY] = prev;
    }
  };

  runHandler().catch((err) => {
    log().error(`[websockets] handler error for '${appName}': ${err.message}`);
    try {
      ws.close(1011, 'handler error');
    } catch (_) {
      /* ignore */
    }
  });
}

/**
 * @param {object} entry
 */
function createFacade(entry) {
  const S = state();
  const listeners = {
    message: [],
    close: []
  };

  const facade = {
    id: entry.id,
    get readyState() {
      return entry.ws.readyState;
    },
    get meta() {
      return entry.meta;
    },
    set meta(v) {
      entry.meta = v && typeof v === 'object' ? v : {};
    },
    /** App-level tenant id convention (optional). */
    get tenantId() {
      return entry.meta && entry.meta.tenantId;
    },
    set tenantId(v) {
      entry.meta = entry.meta || {};
      entry.meta.tenantId = v;
    },
    send(data) {
      if (entry.ws.readyState !== WebSocket.OPEN) return false;
      try {
        if (typeof data === 'object' && data !== null && !Buffer.isBuffer(data)) {
          entry.ws.send(JSON.stringify(data));
        } else {
          entry.ws.send(data);
        }
        entry.lastActivity = Date.now();
        return true;
      } catch (_) {
        return false;
      }
    },
    close(code, reason) {
      try {
        entry.ws.close(code, reason);
      } catch (_) {
        /* ignore */
      }
    },
    join(room) {
      joinRoom(entry.appName, String(room), entry.id);
    },
    leave(room) {
      leaveRoom(entry.appName, String(room), entry.id);
    },
    /**
     * Send to everyone in room except this socket.
     * @param {string} room
     * @param {*} data
     */
    to(room) {
      return {
        send: (data) => {
          sendToRoom(entry.appName, String(room), data, { excludeId: entry.id });
        }
      };
    },
    on(event, fn) {
      if (listeners[event] && typeof fn === 'function') {
        listeners[event].push(fn);
      }
    },
    _emit(event, ...args) {
      const list = listeners[event] || [];
      for (const fn of list) {
        try {
          const r = fn(...args);
          if (r && typeof r.then === 'function') {
            r.catch((e) =>
              log().error(`[websockets] listener error: ${e.message}`)
            );
          }
        } catch (e) {
          log().error(`[websockets] listener error: ${e.message}`);
        }
      }
    }
  };
  return facade;
}

function joinRoom(appName, room, socketId) {
  const S = state();
  if (!S.rooms.has(appName)) S.rooms.set(appName, new Map());
  const appRooms = S.rooms.get(appName);
  if (!appRooms.has(room)) appRooms.set(room, new Set());
  appRooms.get(room).add(socketId);
  const entry = S.sockets.get(socketId);
  if (entry) entry.rooms.add(room);
}

function leaveRoom(appName, room, socketId) {
  const S = state();
  const appRooms = S.rooms.get(appName);
  if (appRooms && appRooms.has(room)) {
    appRooms.get(room).delete(socketId);
    if (appRooms.get(room).size === 0) appRooms.delete(room);
  }
  const entry = S.sockets.get(socketId);
  if (entry) entry.rooms.delete(room);
}

/**
 * @param {string} appName
 * @param {string} room
 * @param {*} data
 * @param {object} [opts]
 * @param {string} [opts.excludeId]
 */
function sendToRoom(appName, room, data, opts = {}) {
  const S = state();
  const appRooms = S.rooms.get(appName);
  if (!appRooms || !appRooms.has(room)) return 0;
  let n = 0;
  const payload =
    typeof data === 'object' && data !== null && !Buffer.isBuffer(data)
      ? JSON.stringify(data)
      : data;
  for (const id of appRooms.get(room)) {
    if (opts.excludeId && id === opts.excludeId) continue;
    const entry = S.sockets.get(id);
    if (!entry || entry.ws.readyState !== WebSocket.OPEN) continue;
    try {
      entry.ws.send(payload);
      n++;
    } catch (_) {
      /* ignore */
    }
  }
  return n;
}

/**
 * Broadcast to all connections of an app.
 * @param {string} appName
 * @param {*} data
 */
function sendToApp(appName, data) {
  const S = state();
  let n = 0;
  const payload =
    typeof data === 'object' && data !== null && !Buffer.isBuffer(data)
      ? JSON.stringify(data)
      : data;
  for (const entry of S.sockets.values()) {
    if (entry.appName !== appName) continue;
    if (entry.ws.readyState !== WebSocket.OPEN) continue;
    try {
      entry.ws.send(payload);
      n++;
    } catch (_) {
      /* ignore */
    }
  }
  return n;
}

function removeSocket(id) {
  const S = state();
  const entry = S.sockets.get(id);
  if (!entry) return;
  for (const room of [...entry.rooms]) {
    leaveRoom(entry.appName, room, id);
  }
  S.sockets.delete(id);
  const c = (S.appConnCounts.get(entry.appName) || 1) - 1;
  if (c <= 0) S.appConnCounts.delete(entry.appName);
  else S.appConnCounts.set(entry.appName, c);
  updateGauges();
}

function updateGauges() {
  const S = state();
  try {
    metrics.setGauge('gingee_websocket_connections', {}, S.sockets.size);
    for (const [app, n] of S.appConnCounts) {
      metrics.setGauge('gingee_websocket_connections_per_app', { app }, n);
    }
  } catch (_) {
    /* ignore */
  }
}

function startHeartbeat() {
  const S = state();
  if (S.heartbeatTimer) clearInterval(S.heartbeatTimer);
  const ms = S.serverConfig.heartbeat_ms;
  if (!ms || ms < 1000) return;
  S.heartbeatTimer = setInterval(() => {
    const now = Date.now();
    const idle = S.serverConfig.idle_timeout_ms;
    for (const [id, entry] of [...S.sockets.entries()]) {
      if (entry.ws.readyState !== WebSocket.OPEN) {
        removeSocket(id);
        continue;
      }
      if (idle && now - entry.lastActivity > idle) {
        try {
          entry.ws.close(1001, 'idle timeout');
        } catch (_) {
          /* ignore */
        }
        removeSocket(id);
        continue;
      }
      try {
        entry.ws.ping();
      } catch (_) {
        /* ignore */
      }
    }
  }, ms);
  if (typeof S.heartbeatTimer.unref === 'function') S.heartbeatTimer.unref();
}

function shutdownAll() {
  const S = state();
  if (S.heartbeatTimer) {
    clearInterval(S.heartbeatTimer);
    S.heartbeatTimer = null;
  }
  for (const [id, entry] of [...S.sockets.entries()]) {
    try {
      entry.ws.close(1001, 'server shutdown');
    } catch (_) {
      /* ignore */
    }
    removeSocket(id);
  }
  S.bindings.clear();
  S.rooms.clear();
  if (S.wss) {
    try {
      S.wss.close();
    } catch (_) {
      /* ignore */
    }
    S.wss = null;
  }
}

/**
 * @returns {string|null} app name for the active WS handler/message dispatch
 */
function getActiveAppName() {
  const S = state();
  return globalThis[ACTIVE_APP_KEY] || null;
}

function getConnectionCount(appName) {
  const S = state();
  if (appName) return S.appConnCounts.get(appName) || 0;
  return S.sockets.size;
}

function getRoomSize(appName, room) {
  const S = state();
  const appRooms = S.rooms.get(appName);
  if (!appRooms || !appRooms.has(room)) return 0;
  return appRooms.get(room).size;
}

function getBindings() {
  const S = state();
  const out = [];
  for (const [name, b] of S.bindings) {
    out.push({ appName: name, path: b.fullPath });
  }
  return out;
}

/**
 * Tenant room helper: t:{tenantId}:{name}
 * @param {string|number} tenantId
 * @param {string} name
 */
function tenantRoom(tenantId, name) {
  const S = state();
  const t = String(tenantId == null ? '' : tenantId).trim();
  const n = String(name == null ? '' : name).trim();
  if (!t) throw new Error('tenantRoom requires tenantId');
  if (!n) throw new Error('tenantRoom requires name');
  return `t:${t}:${n}`;
}

/**
 * Ensure room is under tenant prefix (for multi-tenant apps).
 * @param {string} room
 * @param {string|number} tenantId
 */
function assertRoomTenant(room, tenantId) {
  const S = state();
  const prefix = `t:${String(tenantId)}:`;
  if (!String(room).startsWith(prefix)) {
    throw new Error(`Room '${room}' is not in tenant namespace '${prefix}'`);
  }
  return true;
}

module.exports = {
  DEFAULTS,
  initServer,
  setAppsRegistry,
  registerApp,
  unregisterApp,
  attachServer,
  shutdownAll,
  sendToRoom,
  sendToApp,
  joinRoom,
  leaveRoom,
  getConnectionCount,
  getRoomSize,
  getBindings,
  tenantRoom,
  assertRoomTenant,
  parseUpgradeUrl,
  normalizePath,
  fullPathFor,
  getActiveAppName,
  /** test helpers */
  _sockets: state().sockets,
  _bindings: state().bindings,
  _serverConfig: () => state().serverConfig
};
