const nodeFs = require('fs');
const path = require('path');

/**
 * @module secrets
 * @description
 * Resolve secret references in server/app JSON config before modules use them.
 *
 * <b>Supported value forms:</b>
 * - String prefix: <code>"env:MY_VAR"</code>, <code>"file:/run/secrets/db_password"</code>
 * - Object: <code>{ "$secret": "env:MY_VAR" }</code> (optional <code>required: false</code>)
 *
 * <b>Server config:</b> <code>gingee.json</code> → <code>secrets</code>
 *
 * Engine-internal. App scripts cannot <code>require('secrets')</code> and still cannot
 * read host <code>process.env</code> via the gbox sandbox — the engine resolves refs
 * into that app's in-memory config only.
 */

const DEFAULTS = {
  /** When true, load project-root .env into process.env for keys not already set. */
  load_dotenv: false,
  /**
   * Absolute or project-relative directories allowed for file: secrets.
   * Paths outside these roots are rejected.
   */
  file_roots: ['./settings/secrets', '/run/secrets'],
  /**
   * When true (default), missing env:/file: targets throw.
   * When false, missing secrets resolve to null.
   */
  required: true
};

/** @type {object} */
let config = {
  ...DEFAULTS,
  file_roots: [...DEFAULTS.file_roots]
};

/** @type {string} */
let projectRoot = process.cwd();

/** @type {object|null} */
let logger = null;

/**
 * @private
 */
function log() {
  return logger || console;
}

/**
 * @private
 */
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Buffer);
}

/**
 * Parse a simple dotenv file into key/value pairs (no export, no multiline).
 * @private
 */
function parseDotEnv(content) {
  const out = {};
  const lines = String(content).split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Initialize secrets subsystem.
 * @param {object|null|undefined} cfg - gingee.json secrets section
 * @param {string} [root] - project root for relative file roots / .env
 * @param {object} [logRef]
 */
function initServer(cfg, root, logRef) {
  logger = logRef || console;
  projectRoot = root || process.cwd();
  const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  const roots = Array.isArray(c.file_roots) ? c.file_roots : DEFAULTS.file_roots;
  config = {
    load_dotenv: c.load_dotenv === true,
    required: c.required !== false,
    file_roots: roots.map((r) => String(r))
  };

  if (config.load_dotenv) {
    const envPath = path.join(projectRoot, '.env');
    if (nodeFs.existsSync(envPath)) {
      try {
        const parsed = parseDotEnv(nodeFs.readFileSync(envPath, 'utf8'));
        let n = 0;
        for (const [k, v] of Object.entries(parsed)) {
          if (process.env[k] === undefined) {
            process.env[k] = v;
            n++;
          }
        }
        log().info(`[secrets] Loaded .env (${n} new keys into process.env)`);
      } catch (e) {
        log().warn(`[secrets] Failed to load .env: ${e.message}`);
      }
    }
  }

  log().info(
    `[secrets] ready (load_dotenv=${config.load_dotenv}, required=${config.required}, file_roots=${config.file_roots.length})`
  );
}

/**
 * Resolve absolute allowed file roots.
 * @private
 */
function resolvedFileRoots() {
  return config.file_roots.map((r) =>
    path.isAbsolute(r) ? path.normalize(r) : path.resolve(projectRoot, r)
  );
}

/**
 * Ensure candidate path is under an allowed root (isPathInside-style).
 * @private
 */
function isUnderRoot(candidate, root) {
  const c = path.resolve(candidate);
  const r = path.resolve(root);
  if (c === r) return true;
  const prefix = r.endsWith(path.sep) ? r : r + path.sep;
  return c.startsWith(prefix);
}

/**
 * @private
 */
function resolveFileSecret(spec, required) {
  let filePath = String(spec).trim();
  if (!filePath) {
    if (required) throw new Error('[secrets] file: reference is empty');
    return null;
  }
  if (!path.isAbsolute(filePath)) {
    filePath = path.resolve(projectRoot, filePath);
  } else {
    filePath = path.normalize(filePath);
  }

  const roots = resolvedFileRoots();
  const allowed = roots.some((root) => isUnderRoot(filePath, root));
  if (!allowed) {
    throw new Error(
      `[secrets] file path not under allowed secrets.file_roots: ${filePath}`
    );
  }

  if (!nodeFs.existsSync(filePath)) {
    if (required) {
      throw new Error(`[secrets] secret file not found: ${filePath}`);
    }
    return null;
  }

  return nodeFs.readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
}

/**
 * @private
 */
function resolveEnvSecret(name, required) {
  const key = String(name || '').trim();
  if (!key) {
    if (required) throw new Error('[secrets] env: reference is empty');
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(process.env, key) && process.env[key] !== undefined) {
    return process.env[key];
  }
  if (required) {
    throw new Error(`[secrets] environment variable not set: ${key}`);
  }
  return null;
}

/**
 * Parse "env:NAME" / "file:path" / { $secret, required? }
 * @returns {object|null} Parsed form: `{ kind: 'literal'|'ref', value, ref, required }`
 * @private
 */
function parseSecretRef(value) {
  if (typeof value === 'string') {
    if (value.startsWith('env:')) {
      return { kind: 'ref', scheme: 'env', spec: value.slice(4), required: config.required };
    }
    if (value.startsWith('file:')) {
      return { kind: 'ref', scheme: 'file', spec: value.slice(5), required: config.required };
    }
    return { kind: 'literal', value };
  }
  if (isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, '$secret')) {
    const ref = String(value.$secret || '');
    const required =
      value.required !== undefined ? value.required !== false : config.required;
    if (ref.startsWith('env:')) {
      return { kind: 'ref', scheme: 'env', spec: ref.slice(4), required };
    }
    if (ref.startsWith('file:')) {
      return { kind: 'ref', scheme: 'file', spec: ref.slice(5), required };
    }
    throw new Error(`[secrets] unsupported $secret reference: ${ref}`);
  }
  return null;
}

/**
 * Resolve a single config value (literal or secret ref).
 * @param {*} value
 * @returns {*}
 */
function resolveValue(value) {
  const parsed = parseSecretRef(value);
  if (!parsed) {
    // Not a secret ref form — return as-is (objects/arrays handled by resolveDeep)
    return value;
  }
  if (parsed.kind === 'literal') return parsed.value;
  if (parsed.scheme === 'env') return resolveEnvSecret(parsed.spec, parsed.required);
  if (parsed.scheme === 'file') return resolveFileSecret(parsed.spec, parsed.required);
  throw new Error(`[secrets] unknown scheme`);
}

/**
 * Deep-clone JSON-like structure and resolve all secret refs.
 * Does not mutate the input.
 * @param {*} input
 * @returns {*}
 */
function resolveDeep(input) {
  if (input === null || input === undefined) return input;

  // Secret object form must be handled before generic object walk
  const asRef = parseSecretRef(input);
  if (asRef && asRef.kind === 'ref') {
    return resolveValue(input);
  }
  if (asRef && asRef.kind === 'literal' && typeof input === 'string') {
    return asRef.value;
  }

  if (Array.isArray(input)) {
    return input.map((item) => resolveDeep(item));
  }

  if (isPlainObject(input)) {
    // If it has $secret, already handled above; otherwise walk keys
    const out = {};
    for (const [k, v] of Object.entries(input)) {
      out[k] = resolveDeep(v);
    }
    return out;
  }

  if (typeof input === 'string') {
    return resolveValue(input);
  }

  return input;
}

/**
 * Whether a string looks like an unresolved secret ref (for packaging/tests).
 * @param {*} value
 * @returns {boolean}
 */
function isSecretRef(value) {
  const p = parseSecretRef(value);
  return !!(p && p.kind === 'ref');
}

function getConfig() {
  return {
    ...config,
    file_roots: [...config.file_roots],
    projectRoot
  };
}

/** @private */
function _resetForTests() {
  config = { ...DEFAULTS, file_roots: [...DEFAULTS.file_roots] };
  projectRoot = process.cwd();
  logger = null;
}

module.exports = {
  DEFAULTS,
  initServer,
  resolveValue,
  resolveDeep,
  isSecretRef,
  getConfig,
  parseDotEnv,
  _resetForTests
};
