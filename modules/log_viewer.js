/**
 * @module log_viewer
 * @description Path-safe listing and tail-read of Gingee server and app log files.
 * Engine-internal / privileged platform only — not for sandboxed app require.
 *
 * Server:  {projectRoot}/logs/gingee-YYYY-MM-DD.log
 * App:     {webPath}/{appName}/box/logs/app-YYYY-MM-DD.log
 */

const nodeFs = require('fs');
const path = require('path');
const { isPathInside } = require('./internal_utils.js');

const DEFAULT_LINES = 100;
const MAX_LINES = 2000;
const MIN_LINES = 1;
/** Max bytes to read from end of file when tailing */
const MAX_READ_BYTES = 512 * 1024;

/**
 * @param {number|string|null|undefined} n
 * @param {number} fallback
 * @returns {number}
 */
function clampLines(n, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(MAX_LINES, Math.max(MIN_LINES, Math.floor(v)));
}

/**
 * @param {string} projectRoot
 * @returns {string}
 */
function serverLogsDir(projectRoot) {
  return path.resolve(projectRoot, 'logs');
}

/**
 * @param {string} webPath
 * @param {string} appName
 * @returns {string}
 */
function appLogsDir(webPath, appName) {
  return path.resolve(webPath, appName, 'box', 'logs');
}

/**
 * Resolve a log directory for scope; throws on invalid scope/app.
 * @param {object} opts
 * @param {string} opts.scope - server | app
 * @param {string} [opts.appName]
 * @param {string} opts.projectRoot
 * @param {string} opts.webPath
 * @returns {string} absolute dir
 */
function resolveLogDir(opts) {
  const scope = String(opts.scope || 'server').toLowerCase();
  const projectRoot = path.resolve(opts.projectRoot);
  const webPath = path.resolve(opts.webPath);

  if (scope === 'server') {
    return serverLogsDir(projectRoot);
  }
  if (scope === 'app') {
    const appName = opts.appName != null ? String(opts.appName).trim() : '';
    if (!appName || appName.includes('..') || appName.includes('/') || appName.includes('\\') || appName.includes('\0')) {
      throw new Error('Invalid appName for log scope.');
    }
    const appBase = path.resolve(webPath, appName);
    if (!isPathInside(appBase, webPath) && appBase !== webPath) {
      throw new Error('App log path escapes web root.');
    }
    return appLogsDir(webPath, appName);
  }
  throw new Error('scope must be "server" or "app".');
}

/**
 * Resolve a specific log file under an allowed directory.
 * @param {string} dir
 * @param {string} fileName
 * @returns {string} absolute file path
 */
function resolveLogFile(dir, fileName) {
  const name = path.basename(String(fileName || ''));
  if (!name || name !== String(fileName).replace(/\\/g, '/').split('/').pop()) {
    throw new Error('Invalid log file name.');
  }
  if (!name.endsWith('.log') || name.includes('..')) {
    throw new Error('Only .log files can be read.');
  }
  // Server: gingee-*.log ; App: app-*.log
  if (!/^(gingee|app)-[\w.-]+\.log$/.test(name) && !/^[a-zA-Z0-9._-]+\.log$/.test(name)) {
    throw new Error('Log file name not allowed.');
  }
  const abs = path.resolve(dir, name);
  if (!isPathInside(abs, dir) && abs !== path.resolve(dir, name)) {
    throw new Error('Log path escapes allowed directory.');
  }
  // Double-check containment
  const rel = path.relative(dir, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Log path escapes allowed directory.');
  }
  return abs;
}

/**
 * List .log files in a log directory (newest mtime first).
 * @param {object} opts
 * @param {string} opts.scope
 * @param {string} [opts.appName]
 * @param {string} opts.projectRoot
 * @param {string} opts.webPath
 * @returns {{ scope: string, appName: string|null, dir: string, files: object[] }}
 */
function listLogFiles(opts) {
  const dir = resolveLogDir(opts);
  const scope = String(opts.scope || 'server').toLowerCase();
  const files = [];
  if (!nodeFs.existsSync(dir)) {
    return {
      scope,
      appName: scope === 'app' ? opts.appName : null,
      dir,
      files: []
    };
  }
  const entries = nodeFs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isFile()) continue;
    const name = ent.name;
    if (!name.endsWith('.log')) continue;
    if (name.startsWith('.')) continue;
    try {
      const abs = path.join(dir, name);
      const st = nodeFs.statSync(abs);
      files.push({
        name,
        size: st.size,
        mtime: st.mtime.toISOString()
      });
    } catch (_) {
      /* skip unreadable */
    }
  }
  files.sort((a, b) => {
    // Prefer date in name descending, then mtime
    return String(b.name).localeCompare(String(a.name)) || String(b.mtime).localeCompare(String(a.mtime));
  });
  return {
    scope,
    appName: scope === 'app' ? opts.appName : null,
    dir,
    files
  };
}

/**
 * Read last portion of a file as UTF-8 string.
 * @param {string} absPath
 * @param {number} maxBytes
 * @returns {{ text: string, fileSize: number, truncatedBytes: boolean }}
 */
function readFileTail(absPath, maxBytes) {
  const st = nodeFs.statSync(absPath);
  const fileSize = st.size;
  if (fileSize === 0) {
    return { text: '', fileSize: 0, truncatedBytes: false };
  }
  const readSize = Math.min(fileSize, maxBytes);
  const start = fileSize - readSize;
  const fd = nodeFs.openSync(absPath, 'r');
  try {
    const buf = Buffer.alloc(readSize);
    nodeFs.readSync(fd, buf, 0, readSize, start);
    let text = buf.toString('utf8');
    const truncatedBytes = start > 0;
    // If we started mid-file, drop partial first line
    if (truncatedBytes) {
      const nl = text.indexOf('\n');
      if (nl >= 0) text = text.slice(nl + 1);
    }
    return { text, fileSize, truncatedBytes };
  } finally {
    nodeFs.closeSync(fd);
  }
}

/**
 * Parse one log line into a display object.
 * @param {string} line
 * @returns {object}
 */
function parseLogLine(line) {
  const raw = line;
  try {
    const j = JSON.parse(line);
    if (j && typeof j === 'object') {
      return {
        ts: j.timestamp || j.ts || j.time || null,
        level: j.level || null,
        app: j.app != null ? String(j.app) : null,
        message: j.message != null ? String(j.message) : raw,
        raw,
        json: true
      };
    }
  } catch (_) {
    /* plain text */
  }
  return {
    ts: null,
    level: null,
    app: null,
    message: raw,
    raw,
    json: false
  };
}

/**
 * True if this line is noise from the Glade Logs viewer itself (list/read APIs).
 * @param {object} entry
 * @returns {boolean}
 */
function isLogViewerQueryNoise(entry) {
  const hay = `${entry.message || ''} ${entry.raw || ''}`;
  // script_runner / gingee middleware lines for logs-list.js and logs-read.js
  return (
    /logs-list\.js/i.test(hay) ||
    /logs-read\.js/i.test(hay) ||
    /\/glade\/api\/logs-list/i.test(hay) ||
    /\/glade\/api\/logs-read/i.test(hay) ||
    /\/api\/logs-list/i.test(hay) ||
    /\/api\/logs-read/i.test(hay)
  );
}

/**
 * @param {object} entry
 * @param {string|null} levelFilter - error|warn|info|all|null
 * @param {boolean} engineOnly - if true, drop lines with app set
 * @param {string|null} q - substring search (case-insensitive)
 * @param {boolean} hideLogQueries - if true, drop Glade Logs API noise
 * @returns {boolean}
 */
function lineMatchesFilters(entry, levelFilter, engineOnly, q, hideLogQueries) {
  if (hideLogQueries && isLogViewerQueryNoise(entry)) return false;
  if (engineOnly && entry.app) return false;
  if (levelFilter && levelFilter !== 'all') {
    const lv = (entry.level || '').toLowerCase();
    const want = String(levelFilter).toLowerCase();
    if (lv !== want) {
      // winston sometimes uses "warning"
      if (!(want === 'warn' && (lv === 'warn' || lv === 'warning'))) return false;
    }
  }
  if (q && String(q).trim()) {
    const needle = String(q).trim().toLowerCase();
    const hay = `${entry.message || ''} ${entry.raw || ''} ${entry.app || ''}`.toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  return true;
}

/**
 * Tail and parse a log file.
 * @param {object} opts
 * @param {string} opts.scope
 * @param {string} [opts.appName]
 * @param {string} [opts.file] - basename; default newest
 * @param {number} [opts.lines]
 * @param {string} [opts.level]
 * @param {boolean} [opts.engineOnly]
 * @param {boolean} [opts.hideLogQueries] - default true: hide Glade Logs API noise
 * @param {string} [opts.q]
 * @param {string} opts.projectRoot
 * @param {string} opts.webPath
 * @returns {object}
 */
function readLogFile(opts) {
  const scope = String(opts.scope || 'server').toLowerCase();
  const dir = resolveLogDir(opts);
  const listing = listLogFiles(opts);
  if (!listing.files.length) {
    return {
      scope,
      appName: scope === 'app' ? opts.appName : null,
      file: null,
      lines: [],
      fileSize: 0,
      truncatedBytes: false,
      truncatedLines: false,
      lineCountRequested: clampLines(opts.lines, DEFAULT_LINES),
      availableFiles: []
    };
  }

  let fileName;
  if (opts.file != null && String(opts.file).trim()) {
    // Validate name early (rejects path segments / non-.log)
    resolveLogFile(dir, String(opts.file));
    fileName = path.basename(String(opts.file));
    if (!listing.files.some((f) => f.name === fileName)) {
      throw new Error(`Log file not found: ${fileName}`);
    }
  } else {
    fileName = listing.files[0].name;
  }

  const abs = resolveLogFile(dir, fileName);
  if (!nodeFs.existsSync(abs)) {
    throw new Error(`Log file not found: ${fileName}`);
  }

  const wantLines = clampLines(opts.lines, DEFAULT_LINES);
  const level = opts.level != null ? String(opts.level) : 'all';
  const engineOnly = opts.engineOnly === true || opts.engineOnly === 'true' || opts.engineOnly === '1';
  // Default ON: hide noise from this viewer (logs-list / logs-read script traffic)
  const hideLogQueries =
    opts.hideLogQueries === undefined || opts.hideLogQueries === null || opts.hideLogQueries === ''
      ? true
      : opts.hideLogQueries === true ||
        opts.hideLogQueries === 'true' ||
        opts.hideLogQueries === '1' ||
        opts.hideLogQueries === 1;
  const q = opts.q != null ? String(opts.q) : '';

  const { text, fileSize, truncatedBytes } = readFileTail(abs, MAX_READ_BYTES);
  const allLines = text ? text.split(/\r?\n/).filter((l) => l.length > 0) : [];

  // Parse then filter, then take last N matching
  const parsed = allLines.map(parseLogLine);
  const filtered = parsed.filter((e) =>
    lineMatchesFilters(e, level, engineOnly, q, hideLogQueries)
  );
  const truncatedLines = filtered.length > wantLines || truncatedBytes;
  const lines = filtered.slice(-wantLines);

  return {
    scope,
    appName: scope === 'app' ? opts.appName : null,
    file: fileName,
    pathHint: scope === 'server' ? `logs/${fileName}` : `web/${opts.appName}/box/logs/${fileName}`,
    fileSize,
    truncatedBytes,
    truncatedLines,
    lineCountRequested: wantLines,
    lineCountReturned: lines.length,
    engineOnly,
    hideLogQueries,
    level,
    lines,
    availableFiles: listing.files
  };
}

module.exports = {
  DEFAULT_LINES,
  MAX_LINES,
  listLogFiles,
  readLogFile,
  parseLogLine,
  resolveLogDir,
  resolveLogFile,
  clampLines,
  // test helpers
  _readFileTail: readFileTail,
  _lineMatchesFilters: lineMatchesFilters,
  _isLogViewerQueryNoise: isLogViewerQueryNoise
};
