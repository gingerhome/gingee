const path = require("path");
const fs = require("fs");
const { getContext } = require("./gingee.js");

const SCOPES = {
  BOX: "BOX",
  WEB: "WEB",
};

/**
 * Normalize an absolute path for boundary comparison.
 * Resolves `.`/`..`, strips a trailing separator (except roots), and
 * lowercases on Windows where the filesystem is case-insensitive.
 * @param {string} p
 * @returns {string}
 * @private
 */
function _normalizePath(p) {
  if (typeof p !== "string" || p.length === 0) {
    return "";
  }
  let resolved = path.resolve(p);

  // Drop trailing separators so "C:\app" and "C:\app\" compare equal.
  // path.resolve already collapses most cases; this covers explicit trailing seps.
  if (resolved.length > 1) {
    const endsWithSep =
      resolved.endsWith(path.sep) ||
      (path.sep !== "/" && resolved.endsWith("/"));
    if (endsWithSep) {
      resolved = resolved.slice(0, -1);
    }
  }

  if (process.platform === "win32") {
    resolved = resolved.toLowerCase();
  }

  return resolved;
}

/**
 * Resolve a path with `realpath` on every existing ancestor.
 * Non-existent leaf segments are re-joined under the realpath of the deepest
 * existing parent. This closes symlink-jail escapes for paths that do not
 * exist yet (e.g. write targets under a symlink directory).
 *
 * @param {string} p
 * @returns {string} absolute path with intermediate symlinks expanded
 */
function resolveRealPath(p) {
  if (typeof p !== "string" || p.length === 0) {
    return p;
  }
  const abs = path.resolve(p);

  // realpathSync may be mocked (tests) or throw; only trust a non-empty string.
  try {
    const rp = fs.realpathSync(abs);
    if (typeof rp === "string" && rp.length > 0) {
      return rp;
    }
  } catch (_) {
    /* walk ancestors */
  }

  const missing = [];
  let cur = abs;
  while (true) {
    const parent = path.dirname(cur);
    if (parent === cur) {
      // Root never existed (or inaccessible) — lexical fallback.
      return abs;
    }
    missing.unshift(path.basename(cur));
    cur = parent;
    try {
      const realParent = fs.realpathSync(cur);
      if (typeof realParent === "string" && realParent.length > 0) {
        return path.resolve(realParent, ...missing);
      }
    } catch (_) {
      /* keep walking */
    }
  }
}

/**
 * Lexical containment only (no realpath). Used internally after both sides
 * have already been realpath-expanded.
 * @private
 */
function _isPathInsideLexical(candidatePath, boundaryPath) {
  const candidate = _normalizePath(candidatePath);
  const boundary = _normalizePath(boundaryPath);

  if (candidate === boundary) {
    return true;
  }

  // path.relative is the portable way to test containment without prefix false-positives.
  const relative = path.relative(boundary, candidate);

  // Outside, or not representable as a relative path under boundary (different drive, etc.)
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    return false;
  }

  return true;
}

/**
 * Returns true if `candidatePath` is the same as, or a descendant of, `boundaryPath`.
 * Safer than String.startsWith on resolved paths: rejects sibling directories that
 * only share a string prefix (e.g. `/web/app1` vs `/web/app10` or `C:\web\app1` vs
 * `C:\web\app1_evil`).
 *
 * Also expands symlinks via {@link resolveRealPath} so a writable jail cannot
 * escape by planting a symlink to an outside path (H12).
 *
 * @param {string} candidatePath - Absolute or relative path to test.
 * @param {string} boundaryPath - Absolute or relative confinement root.
 * @returns {boolean}
 */
function isPathInside(candidatePath, boundaryPath) {
  if (typeof candidatePath !== "string" || typeof boundaryPath !== "string") {
    return false;
  }
  if (candidatePath.length === 0 || boundaryPath.length === 0) {
    return false;
  }

  const candidate = resolveRealPath(candidatePath);
  const boundary = resolveRealPath(boundaryPath);
  return _isPathInsideLexical(candidate, boundary);
}

/**
 * A secure, internal-only path resolver.
 * Resolves BOX/WEB scoped paths and rejects anything outside the app boundary.
 * Returns a realpath-expanded absolute path so subsequent I/O cannot re-follow
 * intermediate symlinks differently from the jail check.
 * @private
 */
function resolveSecurePath(scope, userPath) {
  const ctx = getContext();
  const app = ctx.app;

  const appBoxPath = app.appBoxPath;
  const appWebPath = app.appWebPath;
  // Host apps use `name`; some tests/legacy shapes use `id`.
  const appName = app.name || app.id || ctx.appName;

  let basePath;
  let finalUserPath = userPath;

  if (userPath.startsWith("/")) {
    const pathSegments = userPath.split("/").filter(Boolean);
    const firstSegment = pathSegments[0];

    if (firstSegment === appName) {
      finalUserPath = path.join("/", ...pathSegments.slice(1));
    }

    basePath = scope === SCOPES.BOX ? appBoxPath : appWebPath;
    finalUserPath = finalUserPath.substring(1);
  } else {
    // No leading "/": relative to the currently executing gbox script folder
    // (store.fsScriptFolder), falling back to the request/job scriptFolder.
    // Module-override wrapper trees keep the caller's fsScriptFolder (see gbox runInGBox).
    basePath = ctx.fsScriptFolder || ctx.scriptFolder;
    if (scope === SCOPES.WEB) {
      basePath = basePath.replace(appBoxPath, appWebPath);
    }
  }

  const requestedPath = path.join(basePath, finalUserPath);
  const secureBoundary = scope === SCOPES.BOX ? appBoxPath : appWebPath;

  const resolved = path.resolve(requestedPath);
  if (!isPathInside(resolved, secureBoundary)) {
    throw new Error(
      `Path Traversal Error: Access to '${userPath}' is forbidden!`,
    );
  }

  // Return realpath-expanded form so open/read/write uses the same jail view.
  return resolveRealPath(resolved);
}

/**
 * Load an optional npm package with a clear operator-facing error.
 * Used when packages live under package.json `optionalDependencies` (or may be
 * omitted via `npm install --omit=optional`).
 *
 * Prefer a **static** loader so Jest/bundlers can resolve and mock the package:
 *   loadOptional(() => require('pdfmake'), 'pdfmake', 'PDF generation')
 *
 * @param {function(): any} loader - zero-arg function that calls require('pkg')
 * @param {string} packageName - npm package name (for error text / npm install hint)
 * @param {string} featureLabel - human feature (e.g. 'PostgreSQL', 'PDF')
 * @returns {any} module.exports of the package
 */
function loadOptional(loader, packageName, featureLabel) {
  try {
    return loader();
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "";
    const missing =
      e.code === "MODULE_NOT_FOUND" ||
      /Cannot find module/.test(msg) ||
      /Cannot find package/.test(msg);
    if (missing) {
      const err = new Error(
        `FEATURE_NOT_INSTALLED: ${featureLabel} requires optional package '${packageName}'. ` +
          `Install it with: npm install ${packageName} ` +
          `(or reinstall without --omit=optional so optionalDependencies are included).`,
      );
      err.code = "FEATURE_NOT_INSTALLED";
      err.packageName = packageName;
      err.feature = featureLabel;
      err.cause = e;
      throw err;
    }
    throw e;
  }
}

/**
 * @deprecated Prefer {@link loadOptional} with a static `() => require('pkg')` loader
 * so Jest mocks apply. Kept for call sites that only need a string require.
 */
function requireOptional(packageName, featureLabel) {
  return loadOptional(() => require(packageName), packageName, featureLabel);
}

/**
 * Read and parse a JSON file. Purges require.cache for the path when present so
 * repeated loads (reload) see disk changes. Throws a clear SyntaxError-style message
 * on invalid JSON (does not crash the process by itself).
 *
 * @param {string} filePath - absolute path
 * @returns {object|array|string|number|boolean|null}
 */
function loadJsonFile(filePath) {
  const fs = require("fs");
  // Prefer readFile + JSON.parse over require() so invalid JSON never leaves a broken module cache entry.
  try {
    const resolved = require.resolve(filePath);
    if (require.cache[resolved]) {
      delete require.cache[resolved];
    }
  } catch (_) {
    /* path may not be resolvable as a module; still readable from disk */
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    const err = new Error(`Cannot read JSON file '${filePath}': ${e.message}`);
    err.code = e.code || "ENOENT";
    err.cause = e;
    throw err;
  }

  try {
    return JSON.parse(raw);
  } catch (e) {
    const err = new Error(`Invalid JSON in '${filePath}': ${e.message}`);
    err.code = "INVALID_JSON";
    err.cause = e;
    throw err;
  }
}

module.exports = {
  SCOPES,
  isPathInside,
  resolveRealPath,
  resolveSecurePath,
  loadOptional,
  requireOptional,
  loadJsonFile,
};
