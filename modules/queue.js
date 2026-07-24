/**
 * @module queue
 * @description
 * Background job queue for Gingee apps.
 *
 * Enqueue work from server scripts; handlers live under <code>box/jobs/</code>
 * (or paths mapped in <code>app.json</code> → <code>queue.jobs</code>).
 *
 * <b>Server:</b> <code>gingee.json</code> → <code>queue</code> (driver <code>memory</code> or <code>redis</code>).
 * <b>IMPORTANT:</b> Requires the <code>queue</code> permission.
 *
 * @example
 * const queue = require('queue');
 * await queue.add('send-welcome', { userId: 42 });
 * // box/jobs/send-welcome.js runs later
 *
 * @example
 * // Job handler (box/jobs/send-welcome.js)
 * module.exports = async function () {
 *   await gingee(async ($g) => {
 *     const { payload, attempt } = $g.queue;
 *     // ...
 *   });
 * };
 */

const { getContext } = require('./gingee.js');
const queueService = require('./engine/queue_service.js');

/**
 * @private
 */
function requireApp() {
  const { app, appName } = getContext();
  if (!app) throw new Error('queue module cannot determine app context.');
  const granted = app.grantedPermissions || [];
  if (!granted.includes('queue')) {
    throw new Error(
      `Security Error: The app '${appName || app.name}' has not been granted permission to access the 'queue' module.`
    );
  }
  return app;
}

/**
 * Enqueue a background job for the current app.
 *
 * @param {string} name - Job name (maps to box/jobs/{name}.js by default)
 * @param {*} [payload] - JSON-serializable data for the handler ($g.queue.payload)
 * @param {object} [options]
 * @param {number} [options.delayMs=0] - Delay before first run
 * @param {number} [options.attempts] - Max attempts (default server queue.default_attempts)
 * @param {number} [options.backoffMs] - Base backoff between retries
 * @param {string} [options.script] - Override script path relative to box/
 * @returns {Promise<{ id: string, name: string, appName: string }>}
 */
async function add(name, payload, options) {
  const app = requireApp();
  return queueService.addJob(app, name, payload, options || {});
}

/**
 * Whether the server queue is enabled and a driver is running.
 * @returns {boolean}
 */
function isEnabled() {
  return queueService.isEnabled();
}

/**
 * Server-side stats (also useful in privileged diagnostics).
 * @returns {object}
 */
function getStats() {
  return queueService.getStats();
}

module.exports = {
  add,
  isEnabled,
  getStats
};
