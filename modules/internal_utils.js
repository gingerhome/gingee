const path = require('path');
const { getContext } = require('./gingee.js');

const SCOPES = {
  BOX: 'BOX',
  WEB: 'WEB'
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
  let resolved = path.resolve(p);

  // Drop trailing separators so "C:\app" and "C:\app\" compare equal.
  // path.resolve already collapses most cases; this covers explicit trailing seps.
  if (resolved.length > 1) {
    const endsWithSep = resolved.endsWith(path.sep) ||
      (path.sep !== '/' && resolved.endsWith('/'));
    if (endsWithSep) {
      resolved = resolved.slice(0, -1);
    }
  }

  if (process.platform === 'win32') {
    resolved = resolved.toLowerCase();
  }

  return resolved;
}

/**
 * Returns true if `candidatePath` is the same as, or a descendant of, `boundaryPath`.
 * Safer than String.startsWith on resolved paths: rejects sibling directories that
 * only share a string prefix (e.g. `/web/app1` vs `/web/app10` or `C:\web\app1` vs
 * `C:\web\app1_evil`).
 *
 * @param {string} candidatePath - Absolute or relative path to test.
 * @param {string} boundaryPath - Absolute or relative confinement root.
 * @returns {boolean}
 */
function isPathInside(candidatePath, boundaryPath) {
  if (typeof candidatePath !== 'string' || typeof boundaryPath !== 'string') {
    return false;
  }
  if (candidatePath.length === 0 || boundaryPath.length === 0) {
    return false;
  }

  const candidate = _normalizePath(candidatePath);
  const boundary = _normalizePath(boundaryPath);

  if (candidate === boundary) {
    return true;
  }

  // path.relative is the portable way to test containment without prefix false-positives.
  const relative = path.relative(boundary, candidate);

  // Outside, or not representable as a relative path under boundary (different drive, etc.)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return false;
  }

  return true;
}

/**
 * A secure, internal-only path resolver.
 * Resolves BOX/WEB scoped paths and rejects anything outside the app boundary.
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

  if (userPath.startsWith('/')) {
    const pathSegments = userPath.split('/').filter(Boolean);
    const firstSegment = pathSegments[0];

    if (firstSegment === appName) {
      finalUserPath = path.join('/', ...pathSegments.slice(1));
    }

    basePath = (scope === SCOPES.BOX) ? appBoxPath : appWebPath;
    finalUserPath = finalUserPath.substring(1);

  } else {
    basePath = ctx.scriptFolder;
    if (scope === SCOPES.WEB) {
      basePath = basePath.replace(appBoxPath, appWebPath);
    }
  }

  const requestedPath = path.join(basePath, finalUserPath);
  const secureBoundary = (scope === SCOPES.BOX) ? appBoxPath : appWebPath;

  const resolved = path.resolve(requestedPath);
  if (!isPathInside(resolved, secureBoundary)) {
    throw new Error(`Path Traversal Error: Access to '${userPath}' is forbidden!`);
  }

  return resolved;
}

module.exports = {
  SCOPES,
  isPathInside,
  resolveSecurePath
};
