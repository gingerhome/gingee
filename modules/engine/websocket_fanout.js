/**
 * @module engine/websocket_fanout
 * @description Multi-node WebSocket room/app broadcast via Redis pub/sub.
 * Engine-internal. Local sockets are delivered by websocket_hub; this module
 * only bridges nodes.
 *
 * Config (under gingee.json → websockets), same redis shape as queue/scheduler:
 *
 *   "websockets": {
 *     "fanout": { "driver": "none" | "redis" },
 *     "redis": { "url" | host/port/..., "key_prefix": "gingee:ws:" }
 *   }
 */

const os = require('os');

const FANOUT_DEFAULTS = {
  driver: 'none' // none | redis
};

const REDIS_DEFAULTS = {
  url: null,
  host: '127.0.0.1',
  port: 6379,
  password: null,
  db: 0,
  key_prefix: 'gingee:ws:'
};

/**
 * @param {object|null|undefined} raw
 * @returns {object}
 */
function normalizeRedis(raw) {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    ...REDIS_DEFAULTS,
    ...r,
    port: r.port != null ? Number(r.port) : REDIS_DEFAULTS.port,
    db: r.db != null ? Number(r.db) : REDIS_DEFAULTS.db,
    key_prefix:
      (r.key_prefix && String(r.key_prefix)) || REDIS_DEFAULTS.key_prefix
  };
}

/**
 * @param {object|null|undefined} wsConfig - full websockets section
 * @returns {{ driver: string, redis: object, nodeId: string }}
 */
function normalizeFanout(wsConfig) {
  const c =
    wsConfig && typeof wsConfig === 'object' && !Array.isArray(wsConfig)
      ? wsConfig
      : {};
  const f =
    c.fanout && typeof c.fanout === 'object' && !Array.isArray(c.fanout)
      ? c.fanout
      : {};
  const driverRaw =
    f.driver != null ? String(f.driver).toLowerCase() : FANOUT_DEFAULTS.driver;
  const nodeId =
    f.node_id != null && String(f.node_id).trim()
      ? String(f.node_id).trim()
      : `${os.hostname()}:${process.pid}`;
  return {
    driver: driverRaw === 'redis' ? 'redis' : 'none',
    nodeId,
    redis: normalizeRedis(c.redis)
  };
}

/**
 * @param {object} redisCfg
 * @param {object} logger
 * @returns {object} ioredis client
 */
function createRedisClient(redisCfg, logger) {
  const Redis = require('ioredis');
  const r = redisCfg || {};
  let client;
  if (r.url || (typeof r === 'string' && r)) {
    const url = r.url || r;
    client = new Redis(String(url), {
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    });
  } else {
    client = new Redis({
      host: r.host || '127.0.0.1',
      port: r.port != null ? Number(r.port) : 6379,
      password: r.password || undefined,
      db: r.db != null ? Number(r.db) : 0,
      maxRetriesPerRequest: null,
      enableReadyCheck: true
    });
  }
  client.on('error', (err) => {
    (logger || console).error(`[websockets:fanout] Redis error: ${err.message}`);
  });
  return client;
}

/**
 * Encode app payload for Redis JSON envelope.
 * @param {*} data
 * @returns {{ encoding: string, body: string }}
 */
function encodePayload(data) {
  if (Buffer.isBuffer(data)) {
    return { encoding: 'base64', body: data.toString('base64') };
  }
  if (typeof data === 'string') {
    return { encoding: 'string', body: data };
  }
  if (data === undefined) {
    return { encoding: 'json', body: 'null' };
  }
  return { encoding: 'json', body: JSON.stringify(data) };
}

/**
 * @param {string} encoding
 * @param {string} body
 * @returns {string|Buffer}
 */
function decodePayload(encoding, body) {
  if (encoding === 'base64') {
    return Buffer.from(String(body || ''), 'base64');
  }
  if (encoding === 'string') {
    return String(body == null ? '' : body);
  }
  // json — deliver as object so hub can re-stringify consistently; or pre-stringified
  try {
    return JSON.parse(body);
  } catch (_) {
    return body;
  }
}

/**
 * Redis pub/sub fan-out bridge.
 */
class RedisFanout {
  /**
   * @param {object} options - normalizeFanout result
   * @param {object} logger
   * @param {object} handlers
   * @param {function(string,string,*):void} handlers.onRoom - (appName, room, data)
   * @param {function(string,*):void} handlers.onApp - (appName, data)
   */
  constructor(options, logger, handlers) {
    this.cfg = options || normalizeFanout({});
    this.logger = logger || console;
    this.handlers = handlers || {};
    this.pub = null;
    this.sub = null;
    this._closed = false;
    this._started = false;
  }

  enabled() {
    return this.cfg.driver === 'redis' && !this._closed;
  }

  channel() {
    return `${this.cfg.redis.key_prefix}broadcast`;
  }

  /**
   * @returns {Promise<void>}
   */
  async start() {
    if (!this.enabled() || this._started) return;

    this.pub = createRedisClient(this.cfg.redis, this.logger);
    this.sub = createRedisClient(this.cfg.redis, this.logger);

    await Promise.all([waitReady(this.pub), waitReady(this.sub)]);

    const ch = this.channel();
    await this.sub.subscribe(ch);
    this.sub.on('message', (channel, message) => {
      if (channel !== ch) return;
      this._onMessage(message);
    });

    this._started = true;
    this.logger.info(
      `[websockets:fanout] Redis pub/sub ready channel=${ch} node=${this.cfg.nodeId}`
    );
  }

  /**
   * @private
   */
  _onMessage(raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      this.logger.error(`[websockets:fanout] bad message JSON: ${e.message}`);
      return;
    }
    if (!msg || msg.v !== 1) return;
    if (msg.origin === this.cfg.nodeId) return; // already delivered locally

    let data;
    try {
      data = decodePayload(msg.encoding || 'json', msg.body);
    } catch (e) {
      this.logger.error(`[websockets:fanout] decode failed: ${e.message}`);
      return;
    }

    try {
      if (msg.scope === 'room' && msg.app && msg.room != null) {
        if (typeof this.handlers.onRoom === 'function') {
          this.handlers.onRoom(String(msg.app), String(msg.room), data);
        }
      } else if (msg.scope === 'app' && msg.app) {
        if (typeof this.handlers.onApp === 'function') {
          this.handlers.onApp(String(msg.app), data);
        }
      }
    } catch (e) {
      this.logger.error(`[websockets:fanout] deliver failed: ${e.message}`);
    }

    try {
      const metrics = require('../metrics.js');
      metrics.inc('gingee_websocket_fanout_receive_total', {
        scope: msg.scope || 'unknown'
      });
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * @param {string} appName
   * @param {string} room
   * @param {*} data
   * @returns {Promise<void>}
   */
  async publishRoom(appName, room, data) {
    if (!this.enabled() || !this.pub) return;
    await this._publish({
      v: 1,
      origin: this.cfg.nodeId,
      scope: 'room',
      app: appName,
      room,
      ...encodePayload(data)
    });
  }

  /**
   * @param {string} appName
   * @param {*} data
   * @returns {Promise<void>}
   */
  async publishApp(appName, data) {
    if (!this.enabled() || !this.pub) return;
    await this._publish({
      v: 1,
      origin: this.cfg.nodeId,
      scope: 'app',
      app: appName,
      ...encodePayload(data)
    });
  }

  /**
   * @private
   */
  async _publish(envelope) {
    try {
      const raw = JSON.stringify(envelope);
      await this.pub.publish(this.channel(), raw);
      try {
        const metrics = require('../metrics.js');
        metrics.inc('gingee_websocket_fanout_publish_total', {
          scope: envelope.scope || 'unknown'
        });
      } catch (_) {
        /* ignore */
      }
    } catch (e) {
      this.logger.error(
        `[websockets:fanout] publish failed (local delivery still applied): ${e.message}`
      );
    }
  }

  async shutdown() {
    this._closed = true;
    this._started = false;
    const close = async (c) => {
      if (!c) return;
      try {
        await c.quit();
      } catch (_) {
        try {
          c.disconnect();
        } catch (_) {
          /* ignore */
        }
      }
    };
    await close(this.sub);
    await close(this.pub);
    this.sub = null;
    this.pub = null;
  }
}

/**
 * @param {object} client - ioredis client
 * @returns {Promise<void>}
 */
function waitReady(client) {
  if (!client || client.status === 'ready') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const cleanup = () => {
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
    };
    client.once('ready', onReady);
    client.once('error', onError);
  });
}

module.exports = {
  FANOUT_DEFAULTS,
  REDIS_DEFAULTS,
  normalizeRedis,
  normalizeFanout,
  encodePayload,
  decodePayload,
  createRedisClient,
  RedisFanout
};
