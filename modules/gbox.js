const nodeFs = require("fs");
const path = require("path");
const vm = require("vm");
const sucrase = require("sucrase");
const { isPathInside } = require("./internal_utils.js");

// List of app modules that require a permission check
const PROTECTED_MODULES = [
  "ai",
  "cache",
  "db",
  "email",
  "fs",
  "httpclient",
  "platform",
  "pdf",
  "zip",
  "image",
  "websockets",
  "queue",
  // Note: 'scheduler' is engine-internal (restricted). Apps declare jobs in app.json;
  // they do not require('scheduler') in v1. The "scheduler" permission gates registration.
];

// A whitelist of globally-allowed, safe UTILITY modules (both built-in and third-party).
const globallyAllowedModules = [
  "url", // built-in
  "querystring", // built-in
  "mime-types", // third-party
];

/**
 * Host Node built-ins that must never be opened via box.allowed_modules.
 * Note: bare 'fs' is the Gingee sandboxed module (modules/fs.js), not host fs —
 * host fs is blocked because it is not on the allowed list and is not a gingee module under node:fs.
 */
const FORBIDDEN_BUILTINS = new Set([
  "child_process",
  "cluster",
  "worker_threads",
  "vm",
  "v8",
  "module",
  "inspector",
  "repl",
  "fs/promises",
  "node:fs",
  "node:fs/promises",
  "node:child_process",
  "node:vm",
  "node:worker_threads",
  "node:module",
  "node:inspector",
]);

const restrictedGlobalModules = [
  "gingee",
  "gbox",
  "gdev",
  "gapp-start",
  "cache_service",
  "internal_utils",
  "platform",
  "scheduler",
  "limits",
  "egress",
  "secrets",
  // Engine observability/control — not for sandboxed apps (privileged only).
  "metrics",
  "audit",
];

const gingee = require("./gingee.js");
const transpileCache = new Map();

/**
 * Sandboxed module instance cache (Node require.cache semantics inside gbox).
 * Keyed by appName + absolute script path so shared local_modules paths do not
 * leak exports / closed-over require across apps.
 * @type {Map<string, { exports: * }>}
 */
const instanceCache = new Map();

/**
 * Build instance-cache key for an app + script path.
 * @private
 * @param {string} appName
 * @param {string} scriptPath
 * @returns {string}
 */
function instanceCacheKey(appName, scriptPath) {
  return `${appName || ""}\0${path.resolve(scriptPath)}`;
}

/**
 * Drop cached sandboxed module instances.
 * When appName is omitted, clears the entire instance cache.
 * When provided, clears only keys for that app (prefix match).
 *
 * @param {string} [appName]
 * @returns {void}
 */
function clearInstanceCache(appName) {
  if (appName == null || appName === "") {
    instanceCache.clear();
    return;
  }
  const prefix = `${appName}\0`;
  for (const key of instanceCache.keys()) {
    if (key.startsWith(prefix)) {
      instanceCache.delete(key);
    }
  }
}

/**
 * Security Error helper for blocked host globals.
 * @private
 */
function blockedHostAccess(name) {
  throw new Error(
    `Security Error: '${name}' is not available in Gingee app scripts (sandbox host isolation).`,
  );
}

/**
 * Current request's `$g` from ALS, or throw.
 * @private
 * @returns {object}
 */
function resolveCurrentG() {
  const store = gingee.als.getStore();
  if (!store) {
    throw new Error(
      `$g is only available during a request's asynchronous execution context (inside gingee(...)).`,
    );
  }
  if (!store.$g) {
    throw new Error(
      `$g is not initialized yet. Use $g inside gingee(async ($g) => { ... }) or code it calls — not at module top level.`,
    );
  }
  return store.$g;
}

/**
 * Live Proxy for bare `$g` / `globalThis.$g` in the sandbox.
 * Always forwards to the current ALS request context (safe with instance cache
 * even if a module does `const local_$g = $g`). Nested snapshots like
 * `const res = $g.response` are still per-request objects — do not stash those.
 * @private
 * @returns {object}
 */
function createLiveGProxy() {
  return new Proxy(Object.create(null), {
    get(_target, prop) {
      if (prop === Symbol.toStringTag) {
        return "GingeeRequestContext";
      }
      const g = resolveCurrentG();
      const value = Reflect.get(g, prop, g);
      if (typeof value === "function") {
        return value.bind(g);
      }
      return value;
    },
    set() {
      throw new Error(
        `Security Error: '$g' is read-only in Gingee app scripts.`,
      );
    },
    has(_target, prop) {
      return Reflect.has(resolveCurrentG(), prop);
    },
    ownKeys() {
      return Reflect.ownKeys(resolveCurrentG());
    },
    getOwnPropertyDescriptor(_target, prop) {
      const desc = Reflect.getOwnPropertyDescriptor(resolveCurrentG(), prop);
      if (!desc) return undefined;
      return { ...desc, configurable: true };
    },
    defineProperty() {
      throw new Error(
        `Security Error: '$g' is read-only in Gingee app scripts.`,
      );
    },
    deleteProperty() {
      throw new Error(
        `Security Error: '$g' is read-only in Gingee app scripts.`,
      );
    },
  });
}

/**
 * Bind a live `$g` getter (→ shared Proxy) onto a sandbox / vm context object.
 * @private
 * @param {object} target
 * @param {object} liveG
 */
function bindLiveG(target, liveG) {
  Object.defineProperty(target, "$g", {
    configurable: true,
    enumerable: true,
    get() {
      // Eager ALS check when reading globalThis.$g
      resolveCurrentG();
      return liveG;
    },
    set() {
      throw new Error(
        `Security Error: '$g' is read-only in Gingee app scripts.`,
      );
    },
  });
}

/**
 * Specifiers that must never be redirected via module_override.
 * @private
 */
function isNonOverridableSpecifier(moduleName, normalized) {
  const raw = String(moduleName || "");
  const norm = normalized != null ? normalized : raw.startsWith("node:") ? raw.slice(5) : raw;
  // Match the specifier as given (and bare form of node:X). Do NOT map bare names to
  // node: bare — bare 'fs' is the Gingee sandbox module and is overridable; only
  // 'node:fs' / 'fs/promises' (host) are forbidden.
  if (FORBIDDEN_BUILTINS.has(raw) || FORBIDDEN_BUILTINS.has(norm)) {
    return true;
  }
  if (
    restrictedGlobalModules.includes(raw) ||
    restrictedGlobalModules.includes(norm)
  ) {
    return true;
  }
  if (
    norm === "engine" ||
    norm.startsWith("engine/") ||
    norm.startsWith("engine\\") ||
    raw === "engine" ||
    raw.startsWith("engine/") ||
    raw.startsWith("engine\\")
  ) {
    return true;
  }
  return false;
}

/**
 * Normalize a path under the app box to a stable forward-slash key (optional .js strip).
 * @private
 */
function toBoxRelativeKey(absPath, appBoxPath) {
  let rel = path.relative(appBoxPath, absPath).split(path.sep).join("/");
  if (rel.startsWith("..")) return null;
  if (rel.endsWith(".js")) rel = rel.slice(0, -3);
  return rel;
}

/**
 * Look up store.moduleOverrides for this require specifier.
 * Matches bare names, node: aliases, and relative/box paths (resolved under the box).
 * @private
 * @returns {string|null} box-relative override target path
 */
function findModuleOverride(
  store,
  moduleName,
  normalized,
  callingScriptPath,
  appBoxPath,
) {
  if (!store || !store.moduleOverrides) return null;
  const map = store.moduleOverrides;
  const candidates = new Set();

  const add = (k) => {
    if (k == null || k === "") return;
    const s = String(k).replace(/\\/g, "/");
    candidates.add(s);
    if (s.endsWith(".js")) candidates.add(s.slice(0, -3));
    else candidates.add(s + ".js");
  };

  add(moduleName);
  add(normalized);

  if (moduleName.startsWith("./") || moduleName.startsWith("../")) {
    let resolved = path.resolve(path.dirname(callingScriptPath), moduleName);
    if (!path.extname(resolved)) resolved += ".js";
    const boxKey = toBoxRelativeKey(resolved, appBoxPath);
    if (boxKey) {
      add(boxKey);
      add("./" + boxKey);
    }
  } else if (
    (moduleName.includes("/") || moduleName.includes("\\")) &&
    !moduleName.startsWith("node:")
  ) {
    // Bare path treated as box-root-relative (same as default_include style requires)
    let resolved = path.resolve(appBoxPath, moduleName);
    if (!path.extname(resolved) && !nodeFs.existsSync(resolved)) {
      if (nodeFs.existsSync(resolved + ".js")) resolved += ".js";
    } else if (!path.extname(resolved)) {
      resolved += ".js";
    }
    const boxKey = toBoxRelativeKey(resolved, appBoxPath);
    if (boxKey) add(boxKey);
  }

  for (const c of candidates) {
    if (Object.prototype.hasOwnProperty.call(map, c) && map[c]) {
      return String(map[c]);
    }
  }
  return null;
}

/**
 * Load an override target from the app box (always with overrides disabled for nested require).
 * @private
 */
function loadModuleOverrideTarget(overrideRel, gBoxConfig) {
  let targetPath = path.resolve(gBoxConfig.appBoxPath, overrideRel);
  if (!path.extname(targetPath)) {
    targetPath += ".js";
  }
  if (!isPathInside(targetPath, gBoxConfig.appBoxPath)) {
    throw new Error(
      `Security Error: module override '${overrideRel}' escapes the app box.`,
    );
  }
  if (!nodeFs.existsSync(targetPath)) {
    throw new Error(
      `Security Error: module override target not found: ${overrideRel}`,
    );
  }
  return runInGBox(targetPath, {
    ...gBoxConfig,
    applyModuleOverrides: false,
  });
}

/**
 * @private
 */
function appHasModuleOverridePermission(gBoxConfig, store) {
  const fromApp = (gBoxConfig.app && gBoxConfig.app.grantedPermissions) || [];
  if (fromApp.includes("module_override")) return true;
  const fromStore =
    store && store.app && Array.isArray(store.app.grantedPermissions)
      ? store.app.grantedPermissions
      : [];
  return fromStore.includes("module_override");
}

/**
 * Read a boolean flag from an object: only explicit <code>false</code> disables.
 * Accepts new and legacy key names.
 * @param {object|null|undefined} obj
 * @returns {boolean|null} false if disabled, true if enabled, null if unset
 * @private
 */
function _readDynamicCodeFlag(obj) {
  if (!obj || typeof obj !== "object") return null;
  if (obj.allow_dynamic_code === false || obj.allow_code_generation === false) {
    return false;
  }
  if (obj.allow_dynamic_code === true || obj.allow_code_generation === true) {
    return true;
  }
  return null;
}

/**
 * Whether sandbox string codegen (eval / new Function) is allowed for the server default.
 * Prefer <code>box.allow_dynamic_code</code>; legacy <code>box.allow_code_generation</code> still honored.
 * Default: true (Instant Time to Joy — many UMD libs need Function at load).
 *
 * @param {object|null|undefined} box - gingee.json box section
 * @returns {boolean}
 */
function allowDynamicCodeFromBox(box) {
  const v = _readDynamicCodeFlag(box);
  return v !== false;
}

/**
 * Resolve allow_dynamic_code for a specific app.
 *
 * Policy (explicit app wins):
 * - If app.json sets <code>allow_dynamic_code</code> (or nested <code>box.allow_dynamic_code</code>),
 *   that value is used — apps may opt in (<code>true</code>) or tighten (<code>false</code>).
 * - Otherwise inherit server <code>box.allow_dynamic_code</code> (default <code>true</code>).
 * - Legacy key <code>allow_code_generation</code> is accepted at both levels.
 *
 * Typical production pattern: server <code>false</code>, only apps that need UMD libs set <code>true</code>.
 *
 * @param {object|null|undefined} serverBox - gingee.json box
 * @param {object|null|undefined} appConfig - app.json (app.config)
 * @returns {boolean}
 */
function resolveAllowDynamicCodeForApp(serverBox, appConfig) {
  const app = appConfig && typeof appConfig === "object" ? appConfig : null;
  if (app) {
    // Top-level app.json key wins when set
    const top = _readDynamicCodeFlag(app);
    if (top !== null) return top;
    // Optional nested app.json box section
    const nested = _readDynamicCodeFlag(app.box);
    if (nested !== null) return nested;
  }
  // Inherit server default (true unless server explicitly sets false)
  return allowDynamicCodeFromBox(serverBox);
}

/**
 * Resolve for a gBoxConfig run (server box + app config; optional per-run override).
 * @param {object} [gBoxConfig]
 * @returns {boolean}
 */
function resolveAllowDynamicCode(gBoxConfig) {
  const cfg = gBoxConfig || {};
  const serverBox = cfg.globalConfig && cfg.globalConfig.box;
  const appConfig = cfg.app && cfg.app.config;
  const appHasExplicit =
    appConfig &&
    (_readDynamicCodeFlag(appConfig) !== null ||
      _readDynamicCodeFlag(appConfig.box) !== null);
  const serverHasExplicit =
    serverBox && _readDynamicCodeFlag(serverBox) !== null;

  // Prefer explicit server/app.json flags when present
  if (appHasExplicit || serverHasExplicit) {
    return resolveAllowDynamicCodeForApp(serverBox, appConfig);
  }

  // Per-run override (call sites / unit tests without config flags)
  if (cfg.allowDynamicCode === false || cfg.allowCodeGeneration === false)
    return false;
  if (cfg.allowDynamicCode === true || cfg.allowCodeGeneration === true)
    return true;

  // Default: inherit server default (true when unset)
  return allowDynamicCodeFromBox(serverBox);
}

/**
 * Build a vm context object without Node host privileges (no process, no real global).
 * @private
 */
function createSandboxContext(gbox, gBoxConfig, scriptPath) {
  // Default ON for Instant Time to Joy (Handlebars and many UMD builds need Function).
  // Host process is still absent from the sandbox; dynamic code alone does not restore process.env.
  // Set box.allow_dynamic_code=false for stricter lockdown when no such libs are used.
  const allowDynamicCode = resolveAllowDynamicCode(gBoxConfig);

  const sandbox = {
    module: gbox.module,
    exports: gbox.module.exports,
    require: gbox.require,
    gingee: gbox.gingee,
    console: gbox.console,
    // Common safe builtins apps expect
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    queueMicrotask,
  };

  if (typeof atob === "function") sandbox.atob = atob;
  if (typeof btoa === "function") sandbox.btoa = btoa;

  // Point "global" aliases at the sandbox only (not the host global).
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;

  // Request-local bare `$g` (ALS-backed live Proxy). Same object as globalThis.$g.
  // Compatible with `gingee(async ($g) => …)` — that parameter is still the real store.$g.
  const liveG = createLiveGProxy();
  bindLiveG(sandbox, liveG);

  // Explicit denials with clear errors (also blocks accidental free-var use).
  for (const name of ["process", "GLOBAL", "root"]) {
    Object.defineProperty(sandbox, name, {
      configurable: false,
      enumerable: false,
      get() {
        blockedHostAccess(name);
      },
      set() {
        blockedHostAccess(name);
      },
    });
  }

  const contextOptions = {
    name: `gingee-gbox:${gBoxConfig.appName || "app"}:${path.basename(scriptPath)}`,
  };

  // Disable eval / new Function / wasm codegen unless explicitly allowed (vendored libs).
  if (!allowDynamicCode) {
    contextOptions.codeGeneration = {
      strings: false,
      wasm: false,
    };
  }

  const ctx = vm.createContext(sandbox, contextOptions);
  // Re-bind after createContext (mirrors module/require reassignment in runInGBox).
  bindLiveG(ctx, liveG);
  // Passed into the CJS wrapper as `$g` (vm IIFE free-var lookup is unreliable).
  Object.defineProperty(ctx, "__gingeeLiveG", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: liveG,
  });
  return ctx;
}

// The list of safe modules is now a parameter.
function createGRequire(callingScriptPath, gBoxConfig) {
  return function gRequire(moduleName) {
    const rawName = String(moduleName || "");
    const normalized = rawName.startsWith("node:") ? rawName.slice(5) : rawName;

    // Restricted / engine / forbidden: never overridable (check restricted before overrides).
    const isEngineInternal =
      normalized === "engine" ||
      normalized.startsWith("engine/") ||
      normalized.startsWith("engine\\");
    if (
      restrictedGlobalModules.includes(moduleName) ||
      restrictedGlobalModules.includes(normalized) ||
      isEngineInternal
    ) {
      if (isEngineInternal) {
        // Never expose modules/engine/* to sandboxed apps (including privileged).
        throw new Error(
          `Security Error: The engine module '${moduleName}' is not available to application scripts.`,
        );
      }
      const { appName } = gingee.getContext(); // Get the app that is making the call.
      // Check if the current app's ID is in the privileged list.
      if (
        gBoxConfig.privilegedApps &&
        gBoxConfig.privilegedApps.includes(appName)
      ) {
        // If it is, allow the require to proceed.
        return require(`./${normalized}.js`);
      } else {
        // If not, throw a hard security error.
        throw new Error(
          `Security Error: The app '${appName}' does not have permission to access the '${moduleName}' module.`,
        );
      }
    }

    // Per-request overrides: protected bare names, other bare names, and relative/box paths.
    // Only module_override is required to apply a redirect; target stays in-box.
    // Nested requires under the override script use applyModuleOverrides: false (current).
    if (
      gBoxConfig.applyModuleOverrides !== false &&
      !isNonOverridableSpecifier(moduleName, normalized)
    ) {
      try {
        const store = gingee.getContext();
        if (appHasModuleOverridePermission(gBoxConfig, store)) {
          const overrideRel = findModuleOverride(
            store,
            moduleName,
            normalized,
            callingScriptPath,
            gBoxConfig.appBoxPath,
          );
          if (overrideRel) {
            return loadModuleOverrideTarget(overrideRel, gBoxConfig);
          }
        }
      } catch (e) {
        if (e && e.message && /No context found/i.test(e.message)) {
          /* non-request load */
        } else {
          throw e;
        }
      }
    }

    // Check if the module is a protected module (Gingee app modules: fs, db, …)
    if (
      PROTECTED_MODULES.includes(moduleName) ||
      PROTECTED_MODULES.includes(normalized)
    ) {
      const granted = gBoxConfig.app.grantedPermissions || [];
      const key = PROTECTED_MODULES.includes(moduleName)
        ? moduleName
        : normalized;
      if (!granted.includes(key)) {
        throw new Error(
          `Security Error: The app '${gBoxConfig.app.name}' has not been granted permission to access the '${key}' module. Please grant permission in Glade or settings/permissions.json.`,
        );
      }
      // Fall through to global modules/ load below (or continue resolution).
    }

    // --- Relative path: ./ or ../ ---
    // Caller under a local_modules root → jail to that root; else jail to app box.
    if (moduleName.startsWith("./") || moduleName.startsWith("../")) {
      const scriptDir = path.dirname(callingScriptPath);
      let targetPath = path.resolve(scriptDir, moduleName);

      // Append .js if no extension is provided
      if (!path.extname(targetPath)) {
        targetPath += ".js";
      }

      const localRoot = findLocalModulesRootContaining(
        callingScriptPath,
        gBoxConfig.localModulesPaths,
      );
      const jailRoot = localRoot || gBoxConfig.appBoxPath;
      if (!isPathInside(targetPath, jailRoot)) {
        throw new Error(
          `Path traversal detected. Access to '${moduleName}' is forbidden.`,
        );
      }

      if (!nodeFs.existsSync(targetPath)) {
        throw new Error(
          `Cannot find local module '${moduleName}' at resolved path: ${targetPath}`,
        );
      }

      return runInGBox(targetPath, gBoxConfig);
    }

    // --- Platform global modules/ (engine modules, e.g. modules/fs.js) ---
    // Always wins over box.local_modules for the same bare name (no shadowing).
    const globalModulePath = path.join(
      gBoxConfig.globalModulesPath,
      moduleName + ".js",
    );
    if (nodeFs.existsSync(globalModulePath)) {
      // Permission already checked for PROTECTED_MODULES above when applicable.
      const mod = require(globalModulePath);
      if (moduleName === "fs" || normalized === "fs") {
        return bindFsExports(
          mod,
          resolveFsBindDir(callingScriptPath, gBoxConfig),
        );
      }
      return mod;
    }
    if (normalized !== moduleName) {
      const alt = path.join(gBoxConfig.globalModulesPath, normalized + ".js");
      if (nodeFs.existsSync(alt)) {
        const mod = require(alt);
        if (normalized === "fs") {
          return bindFsExports(
            mod,
            resolveFsBindDir(callingScriptPath, gBoxConfig),
          );
        }
        return mod;
      }
    }

    // --- Project local_modules (gingee.json → box.local_modules) ---
    // Sandboxed runInGBox; .js only (no index.js); first configured root wins.
    const localHit = resolveFromLocalModules(
      moduleName,
      gBoxConfig.localModulesPaths,
    );
    if (localHit) {
      return runInGBox(localHit, gBoxConfig);
    }

    // Never open dangerous host built-ins (even if listed in allowed_modules).
    if (
      FORBIDDEN_BUILTINS.has(rawName) ||
      FORBIDDEN_BUILTINS.has(normalized) ||
      FORBIDDEN_BUILTINS.has(`node:${normalized}`)
    ) {
      throw new Error(
        `Security Error: Built-in module '${moduleName}' is forbidden in Gingee app scripts.`,
      );
    }

    // --- Globally allowed builtins / allowed_modules ---
    const appAllowedBuiltins = gBoxConfig.allowedBuiltinModules || [];
    if (
      globallyAllowedModules.includes(moduleName) ||
      globallyAllowedModules.includes(normalized) ||
      appAllowedBuiltins.includes(moduleName) ||
      appAllowedBuiltins.includes(normalized)
    ) {
      return require(moduleName);
    }

    // --- App box-root path (default_include style, e.g. shared/bare_util) ---
    let appBoxRelativePath = path.resolve(gBoxConfig.appBoxPath, moduleName);
    if (
      !nodeFs.existsSync(appBoxRelativePath) &&
      !path.extname(appBoxRelativePath) &&
      nodeFs.existsSync(appBoxRelativePath + ".js")
    ) {
      appBoxRelativePath = appBoxRelativePath + ".js";
    }
    if (nodeFs.existsSync(appBoxRelativePath)) {
      if (!isPathInside(appBoxRelativePath, gBoxConfig.appBoxPath)) {
        throw new Error(
          `Path traversal detected. Access to '${moduleName}' is forbidden.`,
        );
      }
      return runInGBox(appBoxRelativePath, gBoxConfig);
    }

    throw new Error(
      `Module '${moduleName}' is not allowed or could not be found.`,
    );
  };
}

/**
 * Which configured local_modules root contains this absolute path (if any).
 * @private
 * @param {string} absPath
 * @param {string[]|undefined} localModulesPaths
 * @returns {string|null}
 */
function findLocalModulesRootContaining(absPath, localModulesPaths) {
  if (!absPath || !Array.isArray(localModulesPaths) || !localModulesPaths.length) {
    return null;
  }
  const resolved = path.resolve(absPath);
  for (const root of localModulesPaths) {
    if (!root) continue;
    const r = path.resolve(root);
    if (resolved === r || isPathInside(resolved, r)) {
      return r;
    }
  }
  return null;
}

/**
 * Bind platform fs exports so each call resolves relative paths against scriptDir.
 * Needed because helpers often call fs after their module has finished loading;
 * runInGBox only sets fsScriptFolder during evaluation of the module body.
 * @private
 */
function bindFsExports(fsExports, scriptDir) {
  const out = {
    BOX: fsExports.BOX,
    WEB: fsExports.WEB,
  };
  for (const key of Object.keys(fsExports)) {
    if (key === "BOX" || key === "WEB") continue;
    const val = fsExports[key];
    if (typeof val !== "function") {
      out[key] = val;
      continue;
    }
    out[key] = function boundFsMethod(...args) {
      let store = null;
      let prev;
      try {
        store = gingee.getContext();
        prev = store.fsScriptFolder;
        store.fsScriptFolder = scriptDir;
      } catch (_) {
        store = null;
      }
      try {
        const ret = val.apply(fsExports, args);
        if (ret && typeof ret.then === "function") {
          return Promise.resolve(ret).finally(() => {
            if (store) store.fsScriptFolder = prev;
          });
        }
        if (store) store.fsScriptFolder = prev;
        return ret;
      } catch (e) {
        if (store) store.fsScriptFolder = prev;
        throw e;
      }
    };
  }
  return out;
}

/**
 * Directory used for relative fs paths when a script require('fs').
 * Override wrappers inherit the caller's fsScriptFolder / request scriptFolder.
 * @private
 */
function resolveFsBindDir(callingScriptPath, gBoxConfig) {
  if (gBoxConfig.applyModuleOverrides === false) {
    try {
      const store = gingee.getContext();
      if (store && (store.fsScriptFolder || store.scriptFolder)) {
        return store.fsScriptFolder || store.scriptFolder;
      }
    } catch (_) {
      /* fall through */
    }
  }
  return path.dirname(callingScriptPath);
}

/**
 * Resolve a bare or box-style specifier under box.local_modules roots (.js only).
 * @private
 * @param {string} moduleName
 * @param {string[]|undefined} localModulesPaths
 * @returns {string|null} absolute path to .js file
 */
function resolveFromLocalModules(moduleName, localModulesPaths) {
  if (!moduleName || !Array.isArray(localModulesPaths) || !localModulesPaths.length) {
    return null;
  }
  // Reject absolute / URI-like / empty segments that could confuse join
  if (
    path.isAbsolute(moduleName) ||
    moduleName.includes("\0") ||
    moduleName.startsWith("node:")
  ) {
    return null;
  }
  const rel = String(moduleName).replace(/\\/g, "/");
  if (rel.startsWith("/") || rel.includes("://")) {
    return null;
  }

  for (const root of localModulesPaths) {
    if (!root) continue;
    let candidate = path.resolve(root, rel);
    if (!path.extname(candidate)) {
      candidate += ".js";
    } else if (!candidate.endsWith(".js")) {
      // Only .js entry files in v1
      continue;
    }
    if (!isPathInside(candidate, root)) {
      continue;
    }
    if (nodeFs.existsSync(candidate) && nodeFs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return null;
}

// The list of allowed modules is now passed in here.
function runInGBox(scriptPath, gBoxConfig) {
  // Caller-relative fs: set ALS fsScriptFolder to this script's directory while it runs.
  // Override wrapper trees (applyModuleOverrides: false) inherit the caller's base so
  // transparent fs facades keep resolving paths as the request/entry script intended.
  let alsStore = null;
  let prevFsScriptFolder;
  const updateFsBase = gBoxConfig.applyModuleOverrides !== false;
  const absScriptPath = path.resolve(scriptPath);
  const cacheKey = instanceCacheKey(gBoxConfig.appName, absScriptPath);

  try {
    alsStore = gingee.getContext();
  } catch (_) {
    alsStore = null;
  }
  if (alsStore && updateFsBase) {
    prevFsScriptFolder = alsStore.fsScriptFolder;
    alsStore.fsScriptFolder = path.dirname(absScriptPath);
  }

  try {
    // Honor useCache / no_cache_regex: never serve or keep a stale instance when off.
    if (!gBoxConfig.useCache) {
      instanceCache.delete(cacheKey);
    } else if (instanceCache.has(cacheKey)) {
      // Reuse module.exports only — do not reuse vm context or request ALS/$g.
      return instanceCache.get(cacheKey).exports;
    }

    let scriptCode;

    if (gBoxConfig.useCache && transpileCache.has(absScriptPath)) {
      scriptCode = transpileCache.get(absScriptPath);
      if (typeof gBoxConfig.logger.debug === "function") {
        gBoxConfig.logger.debug(
          `[CACHE HIT] transpile for script: ${path.basename(absScriptPath)}`,
        );
      }
    } else {
      transpileCache.delete(absScriptPath); // Clear cache entry if it exists
      // Also try legacy key if callers passed a non-resolved path historically
      if (scriptPath !== absScriptPath) {
        transpileCache.delete(scriptPath);
      }
      const originalCode = nodeFs.readFileSync(absScriptPath, "utf8");

      // --- THIS IS THE NEW ESM "SNIFF TEST" ---
      // This regex looks for 'import' or 'export' at the beginning of a line (or the file)
      // or after a semicolon, which is a good indicator of a top-level statement.
      const isEsModule = /^(import|export)\s|;s*(import|export)\s/.test(
        originalCode,
      );

      if (isEsModule) {
        // If it's likely an ESM file, transpile it.
        if (typeof gBoxConfig.logger.debug === "function") {
          gBoxConfig.logger.debug(
            `ESM detected, transpiling: ${path.basename(absScriptPath)}`,
          );
        }
        const transformed = sucrase.transform(originalCode, {
          transforms: ["imports", "jsx", "typescript"],
        });
        scriptCode = transformed.code;
      } else {
        // Otherwise, assume it's CommonJS and use the code as-is.
        scriptCode = originalCode;
      }

      if (gBoxConfig.useCache) {
        // Store the final code (whether transformed or not) in the cache.
        transpileCache.set(absScriptPath, scriptCode);
        if (typeof gBoxConfig.logger.debug === "function") {
          gBoxConfig.logger.debug(
            `[CACHE SET] transpile for script: ${path.basename(absScriptPath)}`,
          );
        }
      }
    }

    const gbox = {
      module: { exports: {} },
      gingee: gingee.gingee,
      console: gBoxConfig.console || console,
      // Pass the list down to create the safe require function.
      require: createGRequire(absScriptPath, gBoxConfig),
    };

    // Keep exports in sync if the script only assigns module.exports
    gbox.module.exports = gbox.module.exports;
    const sandboxContext = createSandboxContext(gbox, gBoxConfig, absScriptPath);

    // Ensure context sees the same module object (createContext copies properties by value
    // for the initial object — module is a reference type so mutations to .exports stick).
    // Re-assign in case createContext cloned poorly on some Node versions:
    sandboxContext.module = gbox.module;
    sandboxContext.exports = gbox.module.exports;
    sandboxContext.require = gbox.require;
    sandboxContext.gingee = gbox.gingee;
    sandboxContext.console = gbox.console;

    // CommonJS-style wrapper so top-level return is invalid and scope is contained.
    // `$g` is the live Proxy (ALS-backed); prefer this over free-var global lookup in vm.
    const wrapped =
      `(function (module, exports, require, gingee, console, $g) {\n` +
      `${scriptCode}\n` +
      `})(module, exports, require, gingee, console, __gingeeLiveG);`;

    // Circular requires: publish the module object before execution (Node-like).
    // Final exports are written again after success (handlers often replace module.exports).
    if (gBoxConfig.useCache) {
      instanceCache.set(cacheKey, { exports: gbox.module.exports });
    }

    try {
      vm.runInContext(wrapped, sandboxContext, {
        filename: absScriptPath,
        displayErrors: true,
      });
    } catch (err) {
      // Do not leave a poisoned instance or transpile entry after a failed load —
      // next attempt must re-read disk (hot-edit / fix-and-retry).
      instanceCache.delete(cacheKey);
      transpileCache.delete(absScriptPath);
      // Normalize codegen blocks into a clear security message
      if (
        err &&
        err.code === "ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG" // unlikely
      ) {
        throw err;
      }
      if (
        err &&
        (err.message || "").includes("Code generation from strings disallowed")
      ) {
        throw new Error(
          `Security Error: eval/Function dynamic code generation is disabled in Gingee app scripts` +
            ` (script: ${path.basename(absScriptPath)}). ` +
            `If a trusted vendored library requires it, set box.allow_dynamic_code=true in gingee.json (server-wide).`,
        );
      }
      throw err;
    }

    if (gBoxConfig.useCache) {
      instanceCache.set(cacheKey, { exports: gbox.module.exports });
    }

    return gbox.module.exports;
  } finally {
    if (alsStore && updateFsBase) {
      alsStore.fsScriptFolder = prevFsScriptFolder;
    }
  }
}

module.exports = {
  transpileCache,
  instanceCache,
  clearInstanceCache,
  createGRequire,
  runInGBox,
  FORBIDDEN_BUILTINS,
  allowDynamicCodeFromBox,
  resolveAllowDynamicCodeForApp,
  resolveAllowDynamicCode,
};
