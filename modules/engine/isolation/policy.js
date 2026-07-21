/**
 * @module engine/isolation/policy
 * @description Decide whether an app runs scripts in a worker process.
 * Engine-internal.
 */

/**
 * @param {object} app - live app object
 * @param {object} config - resolved gingee.json
 * @returns {boolean}
 */
function shouldIsolateApp(app, config) {
  if (!app || !config) return false;

  const iso = config.isolation;
  if (!iso || iso.mode !== 'process') return false;

  const name = app.name;
  // Privileged / control-plane apps always stay in-process (Glade, etc.)
  if (Array.isArray(config.privileged_apps) && config.privileged_apps.includes(name)) {
    return false;
  }

  const appIso = app.config && app.config.isolation;
  if (appIso === 'process') return true;
  if (appIso === 'inprocess' || appIso === 'off' || appIso === false) return false;

  // Explicit allowlist of app names
  if (Array.isArray(iso.apps) && iso.apps.includes(name)) return true;

  return iso.default === 'process';
}

/**
 * Isolation section defaults.
 */
const ISOLATION_DEFAULTS = {
  /** off = all in-process (default). process = allow workers per policy. */
  mode: 'off',
  /** When mode is process and app does not set isolation: inprocess | process */
  default: 'inprocess',
  /** Optional explicit app names to isolate when mode is process */
  apps: [],
  worker_ready_timeout_ms: 15000,
  /** Master waits this long for a worker HTTP result */
  request_timeout_ms: 120000
};

module.exports = {
  shouldIsolateApp,
  ISOLATION_DEFAULTS
};
