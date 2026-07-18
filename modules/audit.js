/**
 * @module audit
 * @description
 * Append-only JSONL audit trail for privileged platform actions
 * (permissions changes and app lifecycle).
 *
 * <b>Config:</b> <code>gingee.json</code> → <code>audit</code>
 *
 * Engine-internal (not for sandboxed app require).
 */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  /** When true, write audit events to the JSONL file. */
  enabled: true,
  /**
   * Path to the audit log file (relative to project root or absolute).
   * Default: logs/audit.jsonl
   */
  path: './logs/audit.jsonl'
};

/** @type {object} */
let config = { ...DEFAULTS };

/** @type {string} */
let projectRoot = process.cwd();

/** @type {string} */
let resolvedPath = path.resolve(projectRoot, DEFAULTS.path);

/** @type {object|null} */
let logger = null;

/**
 * @private
 */
function log() {
  return logger || console;
}

/**
 * @param {object|null|undefined} cfg
 * @param {string} root
 * @param {object} [logRef]
 */
function initServer(cfg, root, logRef) {
  logger = logRef || console;
  projectRoot = root || process.cwd();
  const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  config = {
    enabled: c.enabled !== false,
    path: c.path != null && String(c.path).trim() !== '' ? String(c.path) : DEFAULTS.path
  };
  resolvedPath = path.isAbsolute(config.path)
    ? config.path
    : path.resolve(projectRoot, config.path);

  if (config.enabled) {
    try {
      const dir = path.dirname(resolvedPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    } catch (e) {
      log().error(`[audit] Could not ensure audit directory: ${e.message}`);
    }
    log().info(`[audit] enabled=true path=${resolvedPath}`);
  } else {
    log().info('[audit] enabled=false');
  }
}

function getConfig() {
  return { ...config, resolvedPath };
}

/**
 * Best-effort actor: privileged app currently handling the request (if any).
 * @private
 */
function resolveActor(explicit) {
  if (explicit != null && String(explicit).trim() !== '') {
    return String(explicit);
  }
  try {
    const { getContext } = require('./gingee.js');
    const store = getContext();
    if (store && store.app && store.app.name) return store.app.name;
  } catch (_) {
    /* no ALS context */
  }
  return 'system';
}

/**
 * Emit one audit event as a single JSON line.
 *
 * @param {string} event - Stable event name (e.g. permission.set, app.install)
 * @param {object} [details]
 * @param {object} [options]
 * @param {string} [options.actor] - Override actor (defaults to current app or system)
 * @param {string} [options.app] - Target application name
 */
function emit(event, details = {}, options = {}) {
  if (!config.enabled) return;

  const record = {
    ts: new Date().toISOString(),
    event: String(event || 'unknown'),
    actor: resolveActor(options.actor),
    app: options.app != null ? String(options.app) : details.app != null ? String(details.app) : null,
    details: details && typeof details === 'object' ? details : { value: details }
  };

  // Prefer top-level app; avoid duplicating bulky nested app key when same
  if (record.app && record.details && record.details.app === record.app) {
    const { app: _a, ...rest } = record.details;
    record.details = rest;
  }

  const line = JSON.stringify(record) + '\n';

  try {
    fs.appendFileSync(resolvedPath, line, 'utf8');
  } catch (e) {
    log().error(`[audit] Failed to write event ${record.event}: ${e.message}`);
  }

  try {
    log().info(`[audit] ${record.event} app=${record.app || '-'} actor=${record.actor}`);
  } catch (_) {
    /* ignore */
  }
}

/** @private */
function _resetForTests() {
  config = { ...DEFAULTS };
  projectRoot = process.cwd();
  resolvedPath = path.resolve(projectRoot, DEFAULTS.path);
  logger = null;
}

module.exports = {
  DEFAULTS,
  initServer,
  getConfig,
  emit,
  _resetForTests
};
