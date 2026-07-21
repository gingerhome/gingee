/**
 * @module engine/metrics_hooks
 * @description Live gauges for Prometheus scrape hooks.
 * Engine-internal — not for sandboxed app require.
 */

const limits = require('../limits.js');
const scheduler = require('../scheduler.js');

/**
 * Prometheus scrape hooks (live gauges).
 * @param {object} apps
 * @returns {object}
 */
function metricsScrapeHooks(apps) {
  return {
    limitsStats: limits.getStats(),
    appsCount: apps ? Object.keys(apps).length : 0,
    schedulerJobs: scheduler.listJobs().length
  };
}

module.exports = {
  metricsScrapeHooks
};
