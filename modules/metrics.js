/**
 * @module metrics
 * @description
 * In-process Prometheus text metrics for Gingee.
 *
 * <b>Endpoint:</b> configured path (default <code>/metrics</code>), typically localhost-only.
 * <b>Config:</b> <code>gingee.json</code> → <code>metrics</code>
 *
 * Engine-internal (not for sandboxed app require).
 */

const os = require('os');

const DEFAULTS = {
  enabled: true,
  path: '/metrics',
  /** Empty = allow all. Default localhost only. */
  allow_from: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
  /** Optional bearer token (literal or already-resolved secret). Empty = no token required. */
  bearer_token: null
};

const HISTOGRAM_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

/** @type {object} */
let config = { ...DEFAULTS, allow_from: [...DEFAULTS.allow_from] };

/** @type {object|null} */
let logger = null;

/** @type {string} */
let versionLabel = 'unknown';

/** counter name -> Map(labelKey -> number) */
const counters = new Map();

/** gauge name -> Map(labelKey -> number) */
const gauges = new Map();

/** histogram name -> Map(labelKey -> { buckets: number[], sum, count }) */
const histograms = new Map();

/**
 * @private
 */
function log() {
  return logger || console;
}

/**
 * Stable label key for map storage.
 * @private
 */
function labelKey(labels) {
  if (!labels || typeof labels !== 'object') return '';
  const keys = Object.keys(labels).sort();
  return keys.map((k) => `${k}=${String(labels[k])}`).join(',');
}

/**
 * @private
 */
function escapeLabel(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

/**
 * @private
 */
function formatLabels(labels) {
  if (!labels || Object.keys(labels).length === 0) return '';
  const parts = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${escapeLabel(labels[k])}"`);
  return `{${parts.join(',')}}`;
}

/**
 * @param {object|null|undefined} cfg
 * @param {object} [logRef]
 * @param {string} [version]
 */
function initServer(cfg, logRef, version) {
  logger = logRef || console;
  versionLabel = version || 'unknown';
  const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  config = {
    enabled: c.enabled !== false,
    path: (c.path && String(c.path).startsWith('/') ? String(c.path) : DEFAULTS.path) || DEFAULTS.path,
    allow_from: Array.isArray(c.allow_from)
      ? c.allow_from.map(String)
      : [...DEFAULTS.allow_from],
    bearer_token: c.bearer_token != null && c.bearer_token !== '' ? String(c.bearer_token) : null
  };
  // reset series
  counters.clear();
  gauges.clear();
  histograms.clear();
  setGauge('gingee_up', {}, 1);
  setGauge('gingee_build_info', { version: versionLabel }, 1);
  log().info(
    `[metrics] enabled=${config.enabled} path=${config.path} allow_from=${config.allow_from.length ? config.allow_from.join(',') : '*'}`
  );
}

function getConfig() {
  return {
    ...config,
    allow_from: [...config.allow_from]
  };
}

/**
 * @param {string} name
 * @param {object} [labels]
 * @param {number} [delta=1]
 */
function inc(name, labels = {}, delta = 1) {
  if (!counters.has(name)) counters.set(name, new Map());
  const m = counters.get(name);
  const k = labelKey(labels);
  m.set(k, (m.get(k) || 0) + delta);
  // store labels object with key for render
  if (!m._meta) m._meta = new Map();
  m._meta.set(k, labels);
}

/**
 * @param {string} name
 * @param {object} [labels]
 * @param {number} value
 */
function setGauge(name, labels = {}, value = 0) {
  if (!gauges.has(name)) gauges.set(name, new Map());
  const m = gauges.get(name);
  const k = labelKey(labels);
  m.set(k, value);
  if (!m._meta) m._meta = new Map();
  m._meta.set(k, labels);
}

/**
 * Observe a duration in seconds.
 * @param {string} name
 * @param {object} [labels]
 * @param {number} seconds
 */
function observe(name, labels = {}, seconds = 0) {
  if (!histograms.has(name)) histograms.set(name, new Map());
  const m = histograms.get(name);
  const k = labelKey(labels);
  let h = m.get(k);
  if (!h) {
    h = {
      buckets: HISTOGRAM_BUCKETS.map(() => 0),
      sum: 0,
      count: 0,
      labels
    };
    m.set(k, h);
  }
  h.sum += seconds;
  h.count += 1;
  for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
    if (seconds <= HISTOGRAM_BUCKETS[i]) h.buckets[i] += 1;
  }
}

/**
 * Status class label: 2xx, 3xx, 4xx, 5xx, unknown
 * @param {number} code
 */
function statusClass(code) {
  const n = Number(code);
  if (!Number.isFinite(n)) return 'unknown';
  if (n >= 200 && n < 300) return '2xx';
  if (n >= 300 && n < 400) return '3xx';
  if (n >= 400 && n < 500) return '4xx';
  if (n >= 500 && n < 600) return '5xx';
  return 'unknown';
}

/**
 * Record one finished HTTP request (counter + duration histogram).
 * @param {object} opts
 * @param {string} [opts.app]
 * @param {string} [opts.kind] - script | static | spa | other
 * @param {number} [opts.statusCode]
 * @param {number} [opts.durationSeconds]
 */
function recordHttpRequest(opts = {}) {
  const app = opts.app != null ? String(opts.app) : '_none';
  const kind = opts.kind != null ? String(opts.kind) : 'other';
  const sc = statusClass(opts.statusCode);
  inc('gingee_http_requests_total', { app, kind, status_class: sc });
  if (opts.durationSeconds != null && Number.isFinite(opts.durationSeconds)) {
    observe('gingee_http_request_duration_seconds', { app, kind }, opts.durationSeconds);
  }
}

/**
 * Whether remote address is allowed to scrape metrics.
 * @param {string|undefined} remoteAddress
 * @returns {boolean}
 */
function isAllowedRemote(remoteAddress) {
  if (!config.allow_from || config.allow_from.length === 0) return true;
  if (!remoteAddress) return false;
  const addr = String(remoteAddress).replace(/^::ffff:/, '');
  return config.allow_from.some((a) => {
    const allowed = String(a).replace(/^::ffff:/, '');
    return allowed === remoteAddress || allowed === addr || a === remoteAddress;
  });
}

/**
 * @param {object} req - Node HTTP request
 * @returns {boolean}
 */
function authorizeRequest(req) {
  if (!config.enabled) return false;
  // Use socket address only — never trust X-Forwarded-For for scrape ACL.
  const remote =
    (req.socket && req.socket.remoteAddress) ||
    (req.connection && req.connection.remoteAddress) ||
    '';
  if (!isAllowedRemote(remote)) {
    return false;
  }
  if (config.bearer_token) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${config.bearer_token}`) return false;
  }
  return true;
}

/**
 * Refresh gauges that are polled at scrape time.
 * @param {object} [hooks] - { limitsStats, appsCount, schedulerJobs }
 */
function refreshDynamicGauges(hooks = {}) {
  setGauge('gingee_up', {}, 1);
  setGauge('gingee_build_info', { version: versionLabel }, 1);
  try {
    setGauge('gingee_process_resident_memory_bytes', {}, process.memoryUsage().rss);
    setGauge('gingee_nodejs_heap_used_bytes', {}, process.memoryUsage().heapUsed);
  } catch (_) {
    /* ignore */
  }
  if (hooks.limitsStats) {
    const s = hooks.limitsStats;
    setGauge('gingee_limits_inflight_requests', {}, s.globalInFlight || 0);
    setGauge('gingee_limits_inflight_outbound', {}, s.outboundInFlight || 0);
    if (s.appInFlight && typeof s.appInFlight === 'object') {
      for (const [app, n] of Object.entries(s.appInFlight)) {
        setGauge('gingee_limits_inflight_requests_by_app', { app }, n);
      }
    }
  }
  if (typeof hooks.appsCount === 'number') {
    setGauge('gingee_apps_registered', {}, hooks.appsCount);
  }
  if (typeof hooks.schedulerJobs === 'number') {
    setGauge('gingee_scheduler_jobs_registered', {}, hooks.schedulerJobs);
  }
  setGauge('gingee_process_start_time_seconds', {}, Math.floor(processStart / 1000));
}

const processStart = Date.now();

/**
 * Render Prometheus exposition format.
 * @param {object} [hooks]
 * @returns {string}
 */
function renderPrometheus(hooks) {
  refreshDynamicGauges(hooks);
  const lines = [];

  const emitHelpType = (name, type, help) => {
    lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} ${type}`);
  };

  // Counters
  for (const [name, m] of counters.entries()) {
    emitHelpType(name, 'counter', name);
    for (const [k, val] of m.entries()) {
      if (k === '_meta') continue;
      const labels = (m._meta && m._meta.get(k)) || {};
      lines.push(`${name}${formatLabels(labels)} ${val}`);
    }
  }

  // Gauges
  for (const [name, m] of gauges.entries()) {
    emitHelpType(name, 'gauge', name);
    for (const [k, val] of m.entries()) {
      if (k === '_meta') continue;
      const labels = (m._meta && m._meta.get(k)) || {};
      lines.push(`${name}${formatLabels(labels)} ${val}`);
    }
  }

  // Histograms (observe() already increments every le-bucket that contains the sample)
  for (const [name, m] of histograms.entries()) {
    emitHelpType(name, 'histogram', name);
    for (const [, h] of m.entries()) {
      for (let i = 0; i < HISTOGRAM_BUCKETS.length; i++) {
        const labels = { ...h.labels, le: String(HISTOGRAM_BUCKETS[i]) };
        lines.push(`${name}_bucket${formatLabels(labels)} ${h.buckets[i]}`);
      }
      const infLabels = { ...h.labels, le: '+Inf' };
      lines.push(`${name}_bucket${formatLabels(infLabels)} ${h.count}`);
      lines.push(`${name}_sum${formatLabels(h.labels)} ${h.sum}`);
      lines.push(`${name}_count${formatLabels(h.labels)} ${h.count}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Handle HTTP metrics scrape. Returns true if request was handled.
 * @param {object} req - Node HTTP request
 * @param {object} res - Node HTTP response
 * @param {object} [hooks]
 * @returns {boolean}
 */
function tryHandleRequest(req, res, hooks) {
  if (!config.enabled) return false;
  const urlPath = (req.url || '').split('?')[0];
  if (urlPath !== config.path) return false;

  if (!authorizeRequest(req)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return true;
  }

  const body = renderPrometheus(hooks);
  res.writeHead(200, {
    'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
    'Cache-Control': 'no-cache'
  });
  res.end(body);
  return true;
}

/** @private */
function _resetForTests() {
  config = { ...DEFAULTS, allow_from: [...DEFAULTS.allow_from] };
  counters.clear();
  gauges.clear();
  histograms.clear();
  logger = null;
  versionLabel = 'unknown';
}

module.exports = {
  DEFAULTS,
  HISTOGRAM_BUCKETS,
  initServer,
  getConfig,
  inc,
  setGauge,
  observe,
  statusClass,
  recordHttpRequest,
  renderPrometheus,
  tryHandleRequest,
  authorizeRequest,
  isAllowedRemote,
  _resetForTests
};
