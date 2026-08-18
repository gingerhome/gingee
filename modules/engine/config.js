/**
 * @module engine/config
 * @description Load and merge gingee.json with defaults; resolve secret references.
 * Engine-internal — not for sandboxed app require.
 */

const path = require("path");
const limits = require("../limits.js");
const egress = require("../egress.js");
const secrets = require("../secrets.js");
const metrics = require("../metrics.js");
const audit = require("../audit.js");
const { ISOLATION_DEFAULTS } = require("./isolation/policy.js");
const { DEFAULTS: WEBSOCKET_DEFAULTS } = require("./websocket_hub.js");
const { DEFAULTS: QUEUE_DEFAULTS } = require("./queue_service.js");
const {
  projectRoot,
  resolveWebPath,
  resolveLocalModulesPaths,
} = require("./paths.js");

/**
 * Default gingee.json shape (before user merge).
 * @param {object} [deps] - optional overrides for testing
 */
function buildDefaultConfig() {
  return {
    server: {
      http: {
        enabled: true,
        port: 7070,
      },
      https: {
        enabled: false,
        port: 7443,
        key_file: "./settings/ssl/key.pem",
        cert_file: "./settings/ssl/cert.pem",
      },
      environment: "production", // "development" or "production"
    },
    web_root: "./web",
    content_encoding: {
      enabled: true,
    },
    max_body_size: "25mb",
    logging: {
      level: "error",
      rotation: {
        period_days: 7,
        max_size_mb: 50,
      },
    },
    box: {
      allowed_modules: [],
      // Project-owned library roots (relative to project root). Resolved at load to
      // box.localModulesPaths (absolute). See docs/server-config.md.
      local_modules: [],
      // true (default): allow eval/new Function inside the vm sandbox so common UMD libs
      // (e.g. Handlebars) load. Host process is still blocked. Set false for stricter lockdown.
      // Legacy alias: allow_code_generation (still honored if allow_dynamic_code is unset).
      allow_dynamic_code: true,
    },
    // Scheduler is off by default. Multi-node: coordination.driver "redis" + sibling redis (like queue).
    scheduler: {
      enabled: false,
      timezone: "UTC",
      coordination: {
        driver: "none",
        strategy: "tick",
        lock_ttl_ms: 300000,
        slot_granularity_ms: 10000,
        node_id: null,
      },
      // Same connection field set as queue.redis / cache.redis (used when coordination.driver is redis).
      redis: {
        url: null,
        host: "127.0.0.1",
        port: 6379,
        password: null,
        db: 0,
        key_prefix: "gingee:scheduler:",
      },
    },
    // Request/outbound timeouts and concurrency (app.json limits may only tighten these).
    limits: { ...limits.DEFAULTS },
    // Outbound URL policy (SSRF hardening). mode "protected" by default.
    egress: { ...egress.DEFAULTS },
    // Secret references: env:VAR / file:path resolved at load (engine only; apps cannot read process.env).
    secrets: {
      ...secrets.DEFAULTS,
      file_roots: [...secrets.DEFAULTS.file_roots],
    },
    // Prometheus scrape endpoint (engine-scoped; default localhost-only).
    metrics: {
      ...metrics.DEFAULTS,
      allow_from: [...metrics.DEFAULTS.allow_from],
    },
    // Append-only JSONL audit for permissions + app lifecycle.
    audit: { ...audit.DEFAULTS },
    // Process isolation for server scripts (default off — all in-process).
    isolation: {
      ...ISOLATION_DEFAULTS,
      apps: [...ISOLATION_DEFAULTS.apps],
      groups: { ...(ISOLATION_DEFAULTS.groups || {}) },
      worker_limits: { ...(ISOLATION_DEFAULTS.worker_limits || {}) },
    },
    // WebSockets (master upgrade; apps opt in via app.json + websockets permission).
    websockets: { ...WEBSOCKET_DEFAULTS },
    // Background job queue (memory default; redis for multi-node).
    queue: {
      ...QUEUE_DEFAULTS,
      redis: { ...(QUEUE_DEFAULTS.redis || {}) },
    },
    default_app: "glade", //set default app as the glade admin panel
    privileged_apps: ["glade"], //set glade as a priviledged app by default
  };
}

/**
 * Deep-merge user gingee.json over defaults (same rules as legacy root gingee.js).
 * @param {object} defaultConfig
 * @param {object} userConfig
 */
function mergeUserConfig(defaultConfig, userConfig) {
  const uc = userConfig && typeof userConfig === "object" ? userConfig : {};
  return {
    ...defaultConfig,
    ...uc,
    server: { ...defaultConfig.server, ...uc.server },
    logging: {
      ...defaultConfig.logging,
      ...uc.logging,
      rotation: {
        ...defaultConfig.logging.rotation,
        ...(uc.logging && uc.logging.rotation),
      },
    },
    box: { ...defaultConfig.box, ...uc.box },
    scheduler: {
      ...defaultConfig.scheduler,
      ...(uc.scheduler || {}),
      coordination: {
        ...(defaultConfig.scheduler.coordination || {}),
        ...((uc.scheduler && uc.scheduler.coordination) || {}),
      },
      // Sibling redis block (queue/cache pattern). Also merge legacy coordination.redis if present.
      redis: {
        ...((defaultConfig.scheduler && defaultConfig.scheduler.redis) || {}),
        ...((uc.scheduler &&
          uc.scheduler.coordination &&
          uc.scheduler.coordination.redis) ||
          {}),
        ...((uc.scheduler && uc.scheduler.redis) || {}),
      },
    },
    limits: { ...defaultConfig.limits, ...(uc.limits || {}) },
    egress: {
      ...defaultConfig.egress,
      ...(uc.egress || {}),
      allow_hosts:
        (uc.egress && uc.egress.allow_hosts) ||
        defaultConfig.egress.allow_hosts ||
        [],
      allow_cidrs:
        (uc.egress && uc.egress.allow_cidrs) ||
        defaultConfig.egress.allow_cidrs ||
        [],
      deny_hosts:
        (uc.egress && uc.egress.deny_hosts) ||
        defaultConfig.egress.deny_hosts ||
        [],
      deny_cidrs:
        (uc.egress && uc.egress.deny_cidrs) ||
        defaultConfig.egress.deny_cidrs ||
        [],
    },
    secrets: {
      ...defaultConfig.secrets,
      ...(uc.secrets || {}),
      file_roots:
        (uc.secrets && uc.secrets.file_roots) ||
        defaultConfig.secrets.file_roots,
    },
    metrics: {
      ...defaultConfig.metrics,
      ...(uc.metrics || {}),
      allow_from:
        (uc.metrics && uc.metrics.allow_from) ||
        defaultConfig.metrics.allow_from,
    },
    audit: {
      ...defaultConfig.audit,
      ...(uc.audit || {}),
    },
    isolation: {
      ...defaultConfig.isolation,
      ...(uc.isolation || {}),
      apps:
        (uc.isolation &&
          Array.isArray(uc.isolation.apps) &&
          uc.isolation.apps) ||
        defaultConfig.isolation.apps ||
        [],
      groups: {
        ...(defaultConfig.isolation.groups || {}),
        ...((uc.isolation && uc.isolation.groups) || {}),
      },
      worker_limits: {
        ...(defaultConfig.isolation.worker_limits || {}),
        ...((uc.isolation && uc.isolation.worker_limits) || {}),
      },
    },
    websockets: {
      ...defaultConfig.websockets,
      ...(uc.websockets || {}),
      fanout: {
        ...(defaultConfig.websockets.fanout || {}),
        ...((uc.websockets && uc.websockets.fanout) || {}),
      },
      redis: {
        ...(defaultConfig.websockets.redis || {}),
        ...((uc.websockets && uc.websockets.redis) || {}),
      },
    },
    queue: {
      ...defaultConfig.queue,
      ...(uc.queue || {}),
      redis: {
        ...(defaultConfig.queue && defaultConfig.queue.redis),
        ...((uc.queue && uc.queue.redis) || {}),
      },
    },
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
    config.server.http = {
      ...(config.server.http || {}),
      enabled: true,
      port: p,
    };
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
    userConfig = require(path.join(root, "gingee.json"));
  }

  const rawMergedConfig = mergeUserConfig(defaultConfig, userConfig);

  // Resolve env:/file: secret references in gingee.json (after optional .env load).
  secrets.initServer(rawMergedConfig.secrets, root, console);
  const config = secrets.resolveDeep(rawMergedConfig);
  applyHttpPortEnvOverride(config);

  // Resolve box.local_modules → absolute roots under project (fail closed on bad entries).
  config.box = config.box || {};
  config.box.localModulesPaths = resolveLocalModulesPaths(
    config.box.local_modules,
    root,
  );

  const webPath = resolveWebPath(config.web_root || "./web", root);

  return {
    config,
    webPath,
    defaultConfig,
    projectRoot: root,
  };
}

module.exports = {
  buildDefaultConfig,
  mergeUserConfig,
  applyHttpPortEnvOverride,
  loadConfig,
};
