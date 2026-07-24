/**
 * @module websockets
 * @description
 * Real-time WebSocket helpers for Gingee apps (rooms, broadcast, tenant naming).
 *
 * Connections are accepted by the **master** process (HTTP upgrade on the public port).
 * Configure handlers in <code>app.json</code> → <code>websockets</code>.
 *
 * <b>IMPORTANT:</b> Requires the <code>websockets</code> permission.
 *
 * <b>Multi-tenant apps:</b> prefix rooms with <code>tenantRoom(tenantId, name)</code>
 * so tenants cannot share channels accidentally.
 *
 * @example
 * // From an HTTP script — push to a room
 * const ws = require('websockets');
 * ws.toRoom(ws.tenantRoom(tenantId, 'lobby'), { type: 'ping' });
 *
 * @example
 * // In box websocket handler (see app.json websockets.handler)
 * module.exports = async function (socket, ctx) {
 *   const room = require('websockets').tenantRoom(socket.tenantId || 'default', 'lobby');
 *   socket.join(room);
 *   socket.on('message', (raw) => {
 *     socket.to(room).send({ echo: raw });
 *   });
 * };
 */

const { als, getContext } = require('./gingee.js');
const hub = require('./engine/websocket_hub.js');

/**
 * Resolve current app name from ALS (HTTP, schedule, or WebSocket handler context).
 * @private
 */
function appName() {
  let store = null;
  try {
    store = getContext();
  } catch (_) {
    store = als.getStore() || null;
  }
  const n =
    (store && (store.appName || (store.app && store.app.name))) ||
    hub.getActiveAppName();
  if (!n) throw new Error('websockets module cannot determine app context.');
  return n;
}

/**
 * Send a message to all sockets in a room for the current app.
 * @param {string} room
 * @param {string|object|Buffer} data - Objects are JSON-serialized
 * @returns {number} recipients
 */
function toRoom(room, data) {
  return hub.sendToRoom(appName(), String(room), data);
}

/**
 * Send a message to every open socket for the current app.
 * Prefer {@link toRoom} with tenant-scoped rooms for multi-tenant apps.
 * @param {string|object|Buffer} data
 * @returns {number} recipients
 */
function toApp(data) {
  return hub.sendToApp(appName(), data);
}

/**
 * Build a tenant-scoped room name: <code>t:{tenantId}:{name}</code>
 * @param {string|number} tenantId
 * @param {string} name - logical room (e.g. "lobby", "channel:42")
 * @returns {string}
 */
function tenantRoom(tenantId, name) {
  return hub.tenantRoom(tenantId, name);
}

/**
 * Throw if room is not under the given tenant prefix.
 * @param {string} room
 * @param {string|number} tenantId
 * @returns {true}
 */
function assertRoomTenant(room, tenantId) {
  return hub.assertRoomTenant(room, tenantId);
}

/**
 * @returns {number} open connections for the current app
 */
function getConnectionCount() {
  return hub.getConnectionCount(appName());
}

/**
 * @param {string} room
 * @returns {number}
 */
function getRoomSize(room) {
  return hub.getRoomSize(appName(), String(room));
}

module.exports = {
  toRoom,
  toApp,
  tenantRoom,
  assertRoomTenant,
  getConnectionCount,
  getRoomSize
};
