/**
 * @module engine/config
 * @description Load and merge gingee.json with defaults; resolve secret references.
 * Engine-internal — not for sandboxed app require.
 */

const path = require('path');
const limits = require('../limits.js');
const egress = require('../egress.js');
const secrets = require('../secrets.js');
const metrics = require('../metrics.js');
const audit = require('../audit.js');
const { projectRoot, resolveWebPath } = require('./paths.js');

/**
 * Default gingee.json shape (before user merge).
 * @param {object} [deps] - optional overrides for testing
 */
function buildDefaultConfig() {
  return {
    server: {
      http: {
        enabled: true,
        port: 7070
      },
      https: {
        enabled: false,
        port: 7443,
        key_file: './settings/ssl/key.pem',
        cert_file: './settings/ssl/cert.pem'
      },
      environment: 'production' // "development" or "production"
    },
    web_root: './web',
    content_encoding: {
      enabled: true
    },
    max_body_size: '25mb',
    logging: {
      level: 'error',
      rotation: {
        period_days: 7,
        max_size_mb: 50
      }
    },
    box: {
      allowed_modules: [],
      // true (default): allow eval/new Function inside the vm sandbox so common UMD libs
      // (e.g. Handlebars) load. Host process is still blocked. Set false for stricter lockdown.
      allow_code_generation: true
    },
    // Scheduler is off by default. Enable on at most one node in multi-server deployments.
    scheduler: {
      enabled: false,
      timezone: 'UTC'
    },
    // Request/outbound timeouts and concurrency (app.json limits may only tighten these).
    limits: { ...limits.DEFAULTS },
    // Outbound URL policy (SSRF hardening). mode "protected" by default.
    egress: { ...egress.DEFAULTS },
    // Secret references: env:VAR / file:path resolved at load (engine only; apps cannot read process.env).
    secrets: { ...secrets.DEFAULTS, file_roots: [...secrets.DEFAULTS.file_roots] },
    // Prometheus scrape endpoint (engine-scoped; default localhost-only).
    metrics: { ...metrics.DEFAULTS, allow_from: [...metrics.DEFAULTS.allow_from] },
    // Append-only JSONL audit for permissions + app lifecycle.
    audit: { ...audit.DEFAULTS },
    default_app: 'glade', //set default app as the glade admin panel
    privileged_apps: ['glade'] //set glade as a priviledged app by default
  };
}

/**
 * Deep-merge user gingee.json over defaults (same rules as legacy root gingee.js).
 * @param {object} defaultConfig
 * @param {object} userConfig
 */
function mergeUserConfig(defaultConfig, userConfig) {
  const uc = userConfig && typeof userConfig === 'object' ? userConfig : {};
  return {
    ...defaultConfig,
    ...uc,
    server: { ...defaultConfig.server, ...uc.server },
    logging: {
      ...defaultConfig.logging,
      ...uc.logging,
      rotation: {
        ...defaultConfig.logging.rotation,
        ...(uc.logging && uc.logging.rotation)
      }
    },
    box: { ...defaultConfig.box, ...uc.box },
    scheduler: { ...defaultConfig.scheduler, ...(uc.scheduler || {}) },
    limits: { ...defaultConfig.limits, ...(uc.limits || {}) },
    egress: {
      ...defaultConfig.egress,
      ...(uc.egress || {}),
      allow_hosts: (uc.egress && uc.egress.allow_hosts) || defaultConfig.egress.allow_hosts || [],
      allow_cidrs: (uc.egress && uc.egress.allow_cidrs) || defaultConfig.egress.allow_cidrs || [],
      deny_hosts: (uc.egress && uc.egress.deny_hosts) || defaultConfig.egress.deny_hosts || [],
      deny_cidrs: (uc.egress && uc.egress.deny_cidrs) || defaultConfig.egress.deny_cidrs || []
    },
    secrets: {
      ...defaultConfig.secrets,
      ...(uc.secrets || {}),
      file_roots:
        (uc.secrets && uc.secrets.file_roots) || defaultConfig.secrets.file_roots
    },
    metrics: {
      ...defaultConfig.metrics,
      ...(uc.metrics || {}),
      allow_from:
        (uc.metrics && uc.metrics.allow_from) || defaultConfig.metrics.allow_from
    },
    audit: {
      ...defaultConfig.audit,
      ...(uc.audit || {})
    }
  };
}

/**
 * Apply GINGEE_HTTP_PORT override (e2e / ops).
 * @param {object} config - mutated in place
 */
function applyHttpPortEnvOverride(config) {
  if (!process.env.GINGEE_HTTP_PORT) return config;
  const p = Number(process.env.GINGEE_HTTP_PORT);
  if (Number.isFinite(p) && p > 0) {
    config.server = config.server || {};
    config.server.http = { ...(config.server.http || {}), enabled: true, port: p };
  }
  return config;
}

/**
 * Load project gingee.json, merge defaults, resolve secrets, resolve web path.
 * @param {object} [options]
 * @param {string} [options.root] - project root (default process.cwd())
 * @param {object} [options.userConfig] - inject config (tests); skips disk read when set
 * @returns {{ config: object, webPath: string, defaultConfig: object, projectRoot: string }}
 */
function loadConfig(options = {}) {
  const root = options.root || projectRoot;
  const defaultConfig = buildDefaultConfig();

  let userConfig = options.userConfig;
  if (userConfig == null) {
    // Same as legacy: require from project root (throws if missing — intentional).
    userConfig = require(path.join(root, 'gingee.json'));
  }

  const rawMergedConfig = mergeUserConfig(defaultConfig, userConfig);

  // Resolve env:/file: secret references in gingee.json (after optional .env load).
  secrets.initServer(rawMergedConfig.secrets, root, console);
  const config = secrets.resolveDeep(rawMergedConfig);
  applyHttpPortEnvOverride(config);

  const webPath = resolveWebPath(config.web_root || './web', root);

  return {
    config,
    webPath,
    defaultConfig,
    projectRoot: root
  };
}

module.exports = {
  buildDefaultConfig,
  mergeUserConfig,
  applyHttpPortEnvOverride,
  loadConfig
};
