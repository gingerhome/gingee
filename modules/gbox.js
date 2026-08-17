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
 * Security Error helper for blocked host globals.
 * @private
 */
function blockedHostAccess(name) {
  throw new Error(
    `Security Error: '${name}' is not available in Gingee app scripts (sandbox host isolation).`,
  );
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

  return vm.createContext(sandbox, contextOptions);
}

// The list of safe modules is now a parameter.
function createGRequire(callingScriptPath, gBoxConfig) {
  return function gRequire(moduleName) {
    const rawName = String(moduleName || "");
    const normalized = rawName.startsWith("node:") ? rawName.slice(5) : rawName;

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

      // Per-request module overrides ($g.overrideModule; requires module_override).
      // Override target loads with applyModuleOverrides: false (real platform require).
      if (gBoxConfig.applyModuleOverrides !== false) {
        try {
          const store = gingee.getContext();
          const canOverride =
            granted.includes('module_override') ||
            (store.app &&
              Array.isArray(store.app.grantedPermissions) &&
              store.app.grantedPermissions.includes('module_override'));
          const overrides = store && store.moduleOverrides;
          const overrideRel =
            canOverride &&
            overrides &&
            (overrides[key] || overrides[moduleName] || overrides[normalized]);
          if (overrideRel) {
            let targetPath = path.resolve(gBoxConfig.appBoxPath, overrideRel);
            if (!path.extname(targetPath)) {
              targetPath += '.js';
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
              applyModuleOverrides: false
            });
          }
        } catch (e) {
          if (e && e.message && /No context found/i.test(e.message)) {
            /* non-request load */
          } else {
            throw e;
          }
        }
      }
    }

    // Check if the module is a restricted module (engine control plane, etc.)
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

    // --- RULE 2: Module with relative path check ---
    if (moduleName.startsWith("./") || moduleName.startsWith("../")) {
      const scriptDir = path.dirname(callingScriptPath);
      let targetPath = path.resolve(scriptDir, moduleName);

      // Append .js if no extension is provided
      if (!path.extname(targetPath)) {
        targetPath += ".js";
      }

      // --- SECURITY CHECK ---
      // Ensure the resolved path is still inside the app's secure 'box' folder.
      // Use isPathInside (not String.startsWith) to reject sibling prefix escapes
      // e.g. box path ".../app1/box" must not allow ".../app10/box/...".
      if (!isPathInside(targetPath, gBoxConfig.appBoxPath)) {
        throw new Error(
          `Path traversal detected. Access to '${moduleName}' is forbidden.`,
        );
      }

      if (!nodeFs.existsSync(targetPath)) {
        throw new Error(
          `Cannot find local module '${moduleName}' at resolved path: ${targetPath}`,
        );
      }

      // Recursively run the new script in the same sandboxed configuration.
      return runInGBox(targetPath, gBoxConfig);
    }

    // --- RULE 2: Global `modules` Folder Check (Gingee modules, e.g. modules/fs.js) ---
    const globalModulePath = path.join(
      gBoxConfig.globalModulesPath,
      moduleName + ".js",
    );
    if (nodeFs.existsSync(globalModulePath)) {
      // Permission already checked for PROTECTED_MODULES above when applicable.
      return require(globalModulePath);
    }
    if (normalized !== moduleName) {
      const alt = path.join(gBoxConfig.globalModulesPath, normalized + ".js");
      if (nodeFs.existsSync(alt)) {
        return require(alt);
      }
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

    // --- RULE 3: Globally Allowed and Built-in Module Check ---
    const appAllowedBuiltins = gBoxConfig.allowedBuiltinModules || [];
    if (
      globallyAllowedModules.includes(moduleName) ||
      globallyAllowedModules.includes(normalized) ||
      appAllowedBuiltins.includes(moduleName) ||
      appAllowedBuiltins.includes(normalized)
    ) {
      return require(moduleName);
    }

    // --- RULE 4: NEW - App-Box-Relative Path Check (for default_includes) ---
    // This rule catches paths like 'utils/formatters.js' which don't start with './'
    // but are not global modules. We treat them as relative to the app's box root.
    const appBoxRelativePath = path.resolve(gBoxConfig.appBoxPath, moduleName);
    if (nodeFs.existsSync(appBoxRelativePath)) {
      // We still must verify it's inside the boundary (reject path traversal / prefix tricks).
      if (!isPathInside(appBoxRelativePath, gBoxConfig.appBoxPath)) {
        throw new Error(
          `Path traversal detected. Access to '${moduleName}' is forbidden.`,
        );
      }
      return runInGBox(appBoxRelativePath, gBoxConfig);
    }

    // --- RULE 5: Deny ---
    throw new Error(
      `Module '${moduleName}' is not allowed or could not be found.`,
    );
  };
}

// The list of allowed modules is now passed in here.
function runInGBox(scriptPath, gBoxConfig) {
  let scriptCode;

  if (gBoxConfig.useCache && transpileCache.has(scriptPath)) {
    scriptCode = transpileCache.get(scriptPath);
    gBoxConfig.logger.info(
      `[CACHE HIT] for script: ${path.basename(scriptPath)}`,
    );
  } else {
    transpileCache.delete(scriptPath); // Clear cache entry if it exists
    const originalCode = nodeFs.readFileSync(scriptPath, "utf8");

    // --- THIS IS THE NEW ESM "SNIFF TEST" ---
    // This regex looks for 'import' or 'export' at the beginning of a line (or the file)
    // or after a semicolon, which is a good indicator of a top-level statement.
    const isEsModule = /^(import|export)\s|;s*(import|export)\s/.test(
      originalCode,
    );

    if (isEsModule) {
      // If it's likely an ESM file, transpile it.
      gBoxConfig.logger.info(
        `ESM detected, transpiling: ${path.basename(scriptPath)}`,
      );
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
      transpileCache.set(scriptPath, scriptCode);
      gBoxConfig.logger.info(
        `[CACHE SET] for script: ${path.basename(scriptPath)}`,
      );
    }
  }

  const gbox = {
    module: { exports: {} },
    gingee: gingee.gingee,
    console: gBoxConfig.console || console,
    // Pass the list down to create the safe require function.
    require: createGRequire(scriptPath, gBoxConfig),
  };

  // Keep exports in sync if the script only assigns module.exports
  gbox.module.exports = gbox.module.exports;
  const sandboxContext = createSandboxContext(gbox, gBoxConfig, scriptPath);

  // Ensure context sees the same module object (createContext copies properties by value
  // for the initial object — module is a reference type so mutations to .exports stick).
  // Re-assign in case createContext cloned poorly on some Node versions:
  sandboxContext.module = gbox.module;
  sandboxContext.exports = gbox.module.exports;
  sandboxContext.require = gbox.require;
  sandboxContext.gingee = gbox.gingee;
  sandboxContext.console = gbox.console;

  // CommonJS-style wrapper so top-level return is invalid and scope is contained.
  const wrapped =
    `(function (module, exports, require, gingee, console) {\n` +
    `${scriptCode}\n` +
    `})(module, exports, require, gingee, console);`;

  try {
    vm.runInContext(wrapped, sandboxContext, {
      filename: scriptPath,
      displayErrors: true,
    });
  } catch (err) {
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
          ` (script: ${path.basename(scriptPath)}). ` +
          `If a trusted vendored library requires it, set box.allow_dynamic_code=true in gingee.json (server-wide).`,
      );
    }
    throw err;
  }

  return gbox.module.exports;
}

module.exports = {
  transpileCache,
  createGRequire,
  runInGBox,
  FORBIDDEN_BUILTINS,
  allowDynamicCodeFromBox,
  resolveAllowDynamicCodeForApp,
  resolveAllowDynamicCode,
};
