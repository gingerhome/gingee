/**
 * @module engine/isolation/policy
 * @description Decide whether an app runs scripts in a worker process, and which worker key (app or group).
 * Engine-internal.
 */

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
  /**
   * Named groups of apps sharing one worker process.
   * Example: { "tenant-a": ["app1", "app2"] }
   */
  groups: {},
  worker_ready_timeout_ms: 15000,
  /** Master waits this long for a worker HTTP result (buffered) */
  request_timeout_ms: 120000,
  /** Auto-restart workers after unexpected exit */
  auto_restart: true,
  /** Max automatic restarts before giving up (reset after stable period) */
  restart_max: 10,
  /** Base delay before first restart (ms); doubles each attempt up to backoff max */
  restart_delay_ms: 500,
  restart_backoff_max_ms: 30000,
  /** After this many ms ready without crash, restart count resets */
  restart_stable_ms: 60000
};

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

  // Member of a group
  if (resolveGroupId(name, iso)) return true;

  // Explicit allowlist of app names
  if (Array.isArray(iso.apps) && iso.apps.includes(name)) return true;

  return iso.default === 'process';
}

/**
 * @param {string} appName
 * @param {object} iso - config.isolation
 * @returns {string|null} group id without prefix, or null
 */
function resolveGroupId(appName, iso) {
  const groups = (iso && iso.groups) || {};
  for (const [groupId, members] of Object.entries(groups)) {
    if (Array.isArray(members) && members.includes(appName)) {
      return String(groupId);
    }
  }
  return null;
}

/**
 * Stable worker map key for an isolated app.
 * @param {object} app
 * @param {object} config
 * @returns {string|null} null if not isolated
 */
function resolveWorkerKey(app, config) {
  if (!shouldIsolateApp(app, config)) return null;
  const iso = config.isolation || {};
  const groupId = resolveGroupId(app.name, iso);
  if (groupId) return `group:${groupId}`;
  return `app:${app.name}`;
}

/**
 * App names that should be loaded into the same worker as this app.
 * @param {object} app
 * @param {object} config
 * @param {object} allApps - full apps registry (optional; falls back to [app.name])
 * @returns {string[]}
 */
function appsForWorker(app, config, allApps) {
  const key = resolveWorkerKey(app, config);
  if (!key) return [];
  if (key.startsWith('group:')) {
    const groupId = key.slice('group:'.length);
    const members = (config.isolation && config.isolation.groups && config.isolation.groups[groupId]) || [];
    // Only include members that exist and are still isolated into this group
    return members.filter((name) => {
      if (allApps && !allApps[name]) return false;
      const a = allApps ? allApps[name] : { name, config: {} };
      return resolveWorkerKey(a, config) === key;
    });
  }
  return [app.name];
}

/**
 * Compute restart delay with exponential backoff.
 * @param {number} attempt - 0-based restart attempt after first crash
 * @param {object} iso
 */
function restartDelayMs(attempt, iso) {
  const base = iso.restart_delay_ms != null ? Number(iso.restart_delay_ms) : ISOLATION_DEFAULTS.restart_delay_ms;
  const max =
    iso.restart_backoff_max_ms != null
      ? Number(iso.restart_backoff_max_ms)
      : ISOLATION_DEFAULTS.restart_backoff_max_ms;
  const n = Math.max(0, attempt);
  return Math.min(max, base * Math.pow(2, n));
}

module.exports = {
  shouldIsolateApp,
  resolveGroupId,
  resolveWorkerKey,
  appsForWorker,
  restartDelayMs,
  ISOLATION_DEFAULTS
};
