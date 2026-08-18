/**
 * @module engine/paths
 * @description Project/engine path helpers for the Gingee control plane.
 * Engine-internal — not for sandboxed app require.
 */

const fs = require("fs");
const path = require("path");

/** Absolute path to the Gingee package root (folder containing gingee.js). */
const engineRoot = path.resolve(__dirname, "..", "..");

/** Absolute path to the consuming project (process.cwd()). */
const projectRoot = process.cwd();

/**
 * Lexical "strictly inside" check (no gingee/ALS dependency — used at config load).
 * @param {string} candidate
 * @param {string} boundary
 * @returns {boolean}
 * @private
 */
function _isStrictlyInside(candidate, boundary) {
  const c = path.resolve(candidate);
  const b = path.resolve(boundary);
  if (c === b) return false;
  const relative = path.relative(b, c);
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
 * Resolve web_root from config to an absolute directory path.
 * @param {string} [configWebPath='./web']
 * @param {string} [root=projectRoot]
 * @returns {string}
 */
function resolveWebPath(configWebPath, root = projectRoot) {
  const p = configWebPath || "./web";
  if (path.isAbsolute(p)) return p;
  return path.resolve(root, p);
}

/**
 * Resolve gingee.json → box.local_modules to absolute roots under the project.
 * v1: relative paths only; absolute entries are rejected. Roots must be strict
 * descendants of the project root (not the project root itself).
 *
 * @param {string|string[]|null|undefined} entries - from box.local_modules
 * @param {string} [root=projectRoot]
 * @returns {string[]} absolute directory paths (may not exist yet)
 * @throws {Error} on absolute path, escape outside project, or project-root entry
 */
function resolveLocalModulesPaths(entries, root = projectRoot) {
  if (entries == null || entries === "") return [];
  const list = Array.isArray(entries)
    ? entries
    : typeof entries === "string"
      ? [entries]
      : [];
  const proj = path.resolve(root);
  const out = [];
  const seen = new Set();

  for (const entry of list) {
    if (entry == null || entry === "") continue;
    if (typeof entry !== "string") {
      throw new Error(
        `box.local_modules entries must be strings (got ${typeof entry}).`,
      );
    }
    const trimmed = entry.trim();
    if (!trimmed) continue;
    if (path.isAbsolute(trimmed)) {
      throw new Error(
        `box.local_modules does not allow absolute paths in v1: "${trimmed}". ` +
          `Use a path relative to the project root (directory of gingee.json).`,
      );
    }
    const resolved = path.resolve(proj, trimmed);
    // Must be strictly inside project (reject "." / project root as a module root).
    if (!_isStrictlyInside(resolved, proj)) {
      throw new Error(
        `box.local_modules path must resolve inside the project root (not the root itself): "${trimmed}".`,
      );
    }
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(resolved);
  }
  return out;
}

/**
 * Absolute local_modules roots from a loaded config (prefers pre-resolved list).
 * @param {object|null|undefined} config - gingee.json config
 * @param {string} [root=projectRoot]
 * @returns {string[]}
 */
function localModulesPathsFromConfig(config, root = projectRoot) {
  if (config && config.box && Array.isArray(config.box.localModulesPaths)) {
    return config.box.localModulesPaths;
  }
  const raw =
    config && config.box ? config.box.local_modules : undefined;
  return resolveLocalModulesPaths(raw, root);
}

/**
 * Ensure standard project directories exist (logs, settings, backups, temp).
 * @param {string} [root=projectRoot]
 */
function ensureProjectDirs(root = projectRoot) {
  const logsDir = path.join(root, "logs");
  const settingsDir = path.join(root, "settings");
  const backupsDir = path.join(root, "backups");
  const tempDir = path.join(root, "temp");
  if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
  if (!fs.existsSync(settingsDir)) fs.mkdirSync(settingsDir);
  if (!fs.existsSync(backupsDir)) fs.mkdirSync(backupsDir);
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
  return { logsDir, settingsDir, backupsDir, tempDir };
}

module.exports = {
  engineRoot,
  projectRoot,
  resolveWebPath,
  resolveLocalModulesPaths,
  localModulesPathsFromConfig,
  ensureProjectDirs,
};
