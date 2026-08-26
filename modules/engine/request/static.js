/**
 * @module engine/request/static
 * @description Serve static files with optional cache + pre-gzip + validators.
 * Engine-internal. Server cache entries store raw + gzip (base64 for cache_service JSON)
 * plus size/mtime for ETag freshness checks.
 * Pre-gzip entries are dropped on app reload via staticFileCache.clear(`static:${appWebPath}`).
 * no_cache_regex (precompiled on the app) skips cache read/write; response may still gzip on the fly.
 * Client cache: public max-age=31536000 with weak ETag (size+mtime) + Last-Modified; 304 on revalidate.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const mimeTypes = require("mime-types");
const {
  matchesNoCache,
  resolveCompiledCacheRegex,
} = require("./cache_config.js");

/**
 * @param {Buffer} data
 * @returns {Promise<Buffer|null>}
 */
function gzipBuffer(data) {
  return new Promise((resolve) => {
    zlib.gzip(data, (err, compressed) => {
      if (err || !compressed) {
        resolve(null);
      } else {
        resolve(compressed);
      }
    });
  });
}

/**
 * Weak ETag from size + mtimeMs.
 * @param {number} size
 * @param {number} mtimeMs
 * @returns {string}
 */
function weakEtag(size, mtimeMs) {
  return `W/"${size}-${mtimeMs}"`;
}

/**
 * @param {Date|number} mtime
 * @returns {string} HTTP-date
 */
function httpDate(mtime) {
  const d = mtime instanceof Date ? mtime : new Date(mtime);
  return d.toUTCString();
}

/**
 * @param {object} stat fs.Stats-like
 * @returns {{ etag: string, lastModified: string, size: number, mtimeMs: number }}
 */
function validatorsFromStat(stat) {
  const size = Number(stat.size) || 0;
  const mtimeMs =
    typeof stat.mtimeMs === "number"
      ? Math.trunc(stat.mtimeMs)
      : stat.mtime
        ? new Date(stat.mtime).getTime()
        : 0;
  return {
    etag: weakEtag(size, mtimeMs),
    lastModified: httpDate(mtimeMs),
    size,
    mtimeMs,
  };
}

/**
 * Weak ETag comparison (strip W/ prefix and quotes for compare).
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function etagMatch(a, b) {
  if (!a || !b) return false;
  const norm = (s) =>
    String(s)
      .trim()
      .replace(/^W\//i, "")
      .replace(/^"|"$/g, "");
  return norm(a) === norm(b);
}

/**
 * @param {object} req
 * @param {string} etag
 * @param {string} lastModified
 * @returns {boolean}
 */
function isNotModified(req, etag, lastModified) {
  const headers = (req && req.headers) || {};
  const inm = headers["if-none-match"];
  if (inm) {
    const parts = String(inm)
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.some((p) => p === "*" || etagMatch(p, etag))) {
      return true;
    }
  }
  const ims = headers["if-modified-since"];
  if (ims && lastModified) {
    const since = Date.parse(ims);
    const mod = Date.parse(lastModified);
    if (!Number.isNaN(since) && !Number.isNaN(mod) && mod <= since) {
      return true;
    }
  }
  return false;
}

/**
 * @param {object} opts
 * @returns {Promise<boolean>} true if this handler owns the response (caller should stop)
 */
async function serveStaticFile(opts) {
  const {
    req,
    res,
    filePath,
    cacheConfig,
    cache,
    canCompress,
    logger,
    headers,
    app,
  } = opts;

  if (!path.extname(filePath)) {
    return false;
  }

  const serverCacheConfig = cacheConfig.server;
  let useCache = !!(serverCacheConfig && serverCacheConfig.enabled);
  const cacheKey = `static:${filePath}`;
  const compiled = resolveCompiledCacheRegex(app, cacheConfig);

  let cacheEntry;
  if (useCache) {
    if (matchesNoCache(compiled.serverNoCache, req.url)) {
      useCache = false;
      if (typeof logger.debug === "function") {
        logger.debug(`No-cache rule matched for path: ${req.url}`);
      }
    } else {
      cacheEntry = await cache.get(cacheKey);
    }
  }

  const clientCacheOn =
    !!(cacheConfig.client && cacheConfig.client.enabled) &&
    !matchesNoCache(compiled.clientNoCache, req.url);

  const applyClientCacheHeaders = (hdrs, validators) => {
    if (clientCacheOn && validators) {
      hdrs["Cache-Control"] = "public, max-age=31536000";
      hdrs["ETag"] = validators.etag;
      hdrs["Last-Modified"] = validators.lastModified;
    } else {
      hdrs["Cache-Control"] = "no-store";
    }
  };

  /**
   * @param {Buffer} raw
   * @param {Buffer|null|undefined} gzipped
   * @param {object} outHeaders
   */
  const sendBody = (raw, gzipped, outHeaders) => {
    if (canCompress) {
      const usePre = gzipped && Buffer.isBuffer(gzipped) ? gzipped : null;
      if (usePre) {
        outHeaders["Content-Encoding"] = "gzip";
        outHeaders["Vary"] = "Accept-Encoding";
        res.writeHead(200, outHeaders);
        res.end(usePre);
        return Promise.resolve();
      }
      return gzipBuffer(raw).then((compressed) => {
        if (compressed && compressed.length < raw.length) {
          outHeaders["Content-Encoding"] = "gzip";
          outHeaders["Vary"] = "Accept-Encoding";
          res.writeHead(200, outHeaders);
          res.end(compressed);
        } else {
          res.writeHead(200, outHeaders);
          res.end(raw);
        }
      });
    }
    res.writeHead(200, outHeaders);
    res.end(raw);
    return Promise.resolve();
  };

  const sendNotModified = (outHeaders) => {
    res.writeHead(304, outHeaders);
    res.end();
  };

  // Prefer live stat so disk replace is reflected even if a stale cache entry remains.
  let diskStat = null;
  try {
    diskStat = fs.statSync(filePath);
    if (!diskStat.isFile()) {
      return false;
    }
  } catch (_) {
    diskStat = null;
  }

  if (useCache && cacheEntry && cacheEntry.content && diskStat) {
    const live = validatorsFromStat(diskStat);
    const cachedMtime = Number(cacheEntry.mtimeMs);
    const cachedSize = Number(cacheEntry.size);
    const fresh =
      cachedMtime === live.mtimeMs && cachedSize === live.size;
    if (!fresh) {
      cacheEntry = null; // treat as miss
    } else {
      headers["Content-Type"] =
        cacheEntry.contentType ||
        mimeTypes.contentType(path.extname(filePath)) ||
        "application/octet-stream";
      if (typeof logger.debug === "function") {
        logger.debug(`[CACHE HIT] Serving static file: ${filePath}`);
      }
      applyClientCacheHeaders(headers, live);

      if (clientCacheOn && isNotModified(req, live.etag, live.lastModified)) {
        sendNotModified(headers);
        return true;
      }

      const content = Buffer.from(cacheEntry.content, "base64");
      let gzipped = null;
      if (cacheEntry.gzipContent) {
        gzipped = Buffer.from(cacheEntry.gzipContent, "base64");
      }
      await sendBody(content, gzipped, headers);
      return true;
    }
  }

  if (!diskStat) {
    // Fall through to readFile path which 404s
  }

  // Static file from disk
  return new Promise((resolve) => {
    fs.stat(filePath, (statErr, stat) => {
      if (statErr || !stat || !stat.isFile()) {
        res.writeHead(404, { "Content-Type": "text/plain" });
        res.end("FILE_NOT_FOUND");
        resolve(true);
        return;
      }
      const validators = validatorsFromStat(stat);

      fs.readFile(filePath, async (err, data) => {
        if (err) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("FILE_NOT_FOUND");
          resolve(true);
          return;
        }
        const ext = path.extname(filePath);
        const contentType =
          mimeTypes.contentType(ext) || "application/octet-stream";
        const outHeaders = { "Content-Type": contentType };
        applyClientCacheHeaders(outHeaders, validators);

        if (
          clientCacheOn &&
          isNotModified(req, validators.etag, validators.lastModified)
        ) {
          sendNotModified(outHeaders);
          resolve(true);
          return;
        }

        const gzipped = await gzipBuffer(data);

        if (useCache) {
          const entry = {
            contentType,
            content: data.toString("base64"),
            size: validators.size,
            mtimeMs: validators.mtimeMs,
            etag: validators.etag,
            lastModified: validators.lastModified,
          };
          if (gzipped) {
            entry.gzipContent = gzipped.toString("base64");
          }
          try {
            await cache.set(cacheKey, entry);
            if (typeof logger.debug === "function") {
              logger.debug(`[CACHE SET] Caching static file: ${filePath}`);
            }
          } catch (e) {
            if (typeof logger.warn === "function") {
              logger.warn(
                `Failed to cache static file ${filePath}: ${e.message}`,
              );
            }
          }
        }

        await sendBody(data, gzipped, outHeaders);
        resolve(true);
      });
    });
  });
}

/**
 * Directory index redirect or 404.
 */
function serveDirectoryOr404(res, filePath, urlWithoutQuery, queryString) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const indexPath = path.join(filePath, "index.html");
    if (fs.existsSync(indexPath)) {
      res.writeHead(301, {
        Location: `${urlWithoutQuery}/index.html${queryString}`,
      });
      res.end();
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("FILE_NOT_FOUND");
    }
    return true;
  }
  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("FILE_NOT_FOUND");
  return true;
}

module.exports = {
  serveStaticFile,
  serveDirectoryOr404,
  // test helpers
  _weakEtag: weakEtag,
  _validatorsFromStat: validatorsFromStat,
  _isNotModified: isNotModified,
};
