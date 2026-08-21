/**
 * @module engine/request/path_confine
 * @description Path confinement helpers for static, SPA, and script resolution.
 * Engine-internal — prevents URL / config path traversal outside app roots.
 */

const path = require("path");
const { isPathInside, resolveRealPath } = require("../../internal_utils.js");

/**
 * True if a single path segment is unsafe to join under a confinement root.
 * @param {string} seg
 * @returns {boolean}
 */
function isUnsafePathSegment(seg) {
  if (seg == null) return true;
  const s = String(seg);
  if (s.length === 0) return true;
  if (s === ".." || s === ".") return true;
  if (s.includes("\0")) return true;
  // Reject absolute / drive / UNC-looking segments slipped into a join list
  if (path.isAbsolute(s)) return true;
  if (/^[a-zA-Z]:/.test(s)) return true;
  if (s.startsWith("\\\\") || s.startsWith("//")) return true;
  // Encoded or embedded traversal leftovers after partial decoding
  if (s.includes("..")) return true;
  return false;
}

/**
 * True if any segment in the list is unsafe.
 * @param {string[]|null|undefined} segments
 * @returns {boolean}
 */
function hasUnsafePathSegments(segments) {
  if (!Array.isArray(segments)) return true;
  for (const seg of segments) {
    if (isUnsafePathSegment(seg)) return true;
  }
  return false;
}

/**
 * Split a relative path string into safe join segments, or null if unsafe.
 * Rejects absolute paths and `..` components.
 * @param {string} relativePath
 * @returns {string[]|null}
 */
function relativeToSegments(relativePath) {
  if (relativePath == null) return null;
  const raw = String(relativePath);
  if (!raw || raw.includes("\0")) return null;
  if (path.isAbsolute(raw)) return null;
  if (/^[a-zA-Z]:/.test(raw)) return null;
  if (raw.startsWith("\\\\") || raw.startsWith("//")) return null;

  const normalized = raw.replace(/\\/g, "/");
  // Empty relative (serve root) is allowed
  if (normalized === "" || normalized === ".") return [];

  const parts = normalized.split("/").filter((p) => p.length > 0 && p !== ".");
  if (hasUnsafePathSegments(parts)) return null;
  return parts;
}

/**
 * Resolve `relativeOrSegments` under `root` and require the result stay inside root.
 * Returns absolute path, or null if the path escapes / is unsafe.
 *
 * @param {string} root - confinement root (app web or box path)
 * @param {string|string[]|null|undefined} relativeOrSegments - relative path or URL segments
 * @param {object} [options]
 * @param {string} [options.rootReal] - Precomputed realpath of root (app.appWebPathReal / appBoxPathReal)
 * @returns {string|null}
 */
function resolveConfinedPath(root, relativeOrSegments, options) {
  if (root == null || root === "") return null;
  const rootAbs = path.resolve(String(root));
  const rootReal =
    options &&
    typeof options.rootReal === "string" &&
    options.rootReal.length > 0
      ? options.rootReal
      : resolveRealPath(rootAbs);

  let segments;
  if (relativeOrSegments == null) {
    segments = [];
  } else if (Array.isArray(relativeOrSegments)) {
    // Filter empty; reject unsafe (including '.')
    segments = relativeOrSegments.map(String).filter((p) => p.length > 0);
    // Allow '.'-only noise by dropping; reject '..'
    segments = segments.filter((p) => p !== ".");
    if (hasUnsafePathSegments(segments)) return null;
  } else {
    segments = relativeToSegments(relativeOrSegments);
    if (segments == null) return null;
  }

  // Join under lexical rootAbs, then jail against rootReal (symlink-safe).
  const candidate =
    segments.length === 0 ? rootAbs : path.resolve(rootAbs, ...segments);

  if (!isPathInside(candidate, rootAbs, { boundaryReal: rootReal })) {
    return null;
  }
  // Return realpath-expanded path so static/script open matches the jail check (H12).
  return resolveRealPath(candidate);
}

/**
 * Resolve a box script path under appBoxPath (routes.json or file routing).
 * @param {string} appBoxPath
 * @param {string|string[]} relativeScript - e.g. "api/hello.js" or URL segments without extension
 * @param {object} [opts]
 * @param {boolean} [opts.appendJs=false] - append ".js" after resolve (file-based routing)
 * @returns {string|null} absolute script path inside box, or null
 */
function confineScriptPath(appBoxPath, relativeScript, opts = {}) {
  const appendJs = opts.appendJs === true;
  const rootReal = opts.rootReal;
  const confineOpts = rootReal ? { rootReal } : undefined;
  if (appendJs) {
    // Join segments first without .js, then append — so confinement applies to the dir+name
    const base = resolveConfinedPath(appBoxPath, relativeScript, confineOpts);
    if (!base) return null;
    // If base is the box root alone and segments were empty, appending .js is wrong
    if (
      base === path.resolve(appBoxPath) &&
      (!relativeScript ||
        (Array.isArray(relativeScript) && relativeScript.length === 0))
    ) {
      return null;
    }
    const withJs = base.endsWith(".js") ? base : `${base}.js`;
    if (
      !isPathInside(withJs, path.resolve(appBoxPath), {
        boundaryReal: rootReal,
      })
    ) {
      return null;
    }
    return resolveRealPath(withJs);
  }
  return resolveConfinedPath(appBoxPath, relativeScript, confineOpts);
}

/**
 * True if candidate is inside the app box (must not be served as static WEB).
 * @param {string} candidatePath
 * @param {string} appBoxPath
 * @param {object} [options]
 * @param {string} [options.boundaryReal] - app.appBoxPathReal
 * @returns {boolean}
 */
function isInsideAppBox(candidatePath, appBoxPath, options) {
  if (!candidatePath || !appBoxPath) return false;
  return isPathInside(candidatePath, appBoxPath, options);
}

/**
 * True if candidate is confined to app web root.
 * @param {string} candidatePath
 * @param {string} appWebPath
 * @param {object} [options]
 * @param {string} [options.boundaryReal] - app.appWebPathReal
 * @returns {boolean}
 */
function isInsideAppWeb(candidatePath, appWebPath, options) {
  if (!candidatePath || !appWebPath) return false;
  return isPathInside(candidatePath, appWebPath, options);
}

module.exports = {
  isUnsafePathSegment,
  hasUnsafePathSegments,
  relativeToSegments,
  resolveConfinedPath,
  confineScriptPath,
  isInsideAppBox,
  isInsideAppWeb,
};
