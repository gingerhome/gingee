/**
 * @module engine/paths
 * @description Project/engine path helpers for the Gingee control plane.
 * Engine-internal — not for sandboxed app require.
 */

const fs = require('fs');
const path = require('path');

/** Absolute path to the Gingee package root (folder containing gingee.js). */
const engineRoot = path.resolve(__dirname, '..', '..');

/** Absolute path to the consuming project (process.cwd()). */
const projectRoot = process.cwd();

/**
 * Resolve web_root from config to an absolute directory path.
 * @param {string} [configWebPath='./web']
 * @param {string} [root=projectRoot]
 * @returns {string}
 */
function resolveWebPath(configWebPath, root = projectRoot) {
  const p = configWebPath || './web';
  if (path.isAbsolute(p)) return p;
  return path.resolve(root, p);
}

/**
 * Ensure standard project directories exist (logs, settings, backups, temp).
 * @param {string} [root=projectRoot]
 */
function ensureProjectDirs(root = projectRoot) {
  const logsDir = path.join(root, 'logs');
  const settingsDir = path.join(root, 'settings');
  const backupsDir = path.join(root, 'backups');
  const tempDir = path.join(root, 'temp');
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
  ensureProjectDirs
};
