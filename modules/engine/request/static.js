/**
 * @module engine/request/static
 * @description Serve static files with optional cache + pre-gzip.
 * Engine-internal. Server cache entries store raw + gzip (base64 for cache_service JSON).
 * Pre-gzip entries are dropped on app reload via staticFileCache.clear(`static:${appWebPath}`).
 * no_cache_regex (precompiled on the app) skips cache read/write; response may still gzip on the fly.
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

  const applyClientCacheControl = (hdrs) => {
    if (
      cacheConfig.client &&
      cacheConfig.client.enabled &&
      !matchesNoCache(compiled.clientNoCache, req.url)
    ) {
      hdrs["Cache-Control"] = "public, max-age=31536000";
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

  if (useCache && cacheEntry && cacheEntry.content) {
    headers["Content-Type"] =
      cacheEntry.contentType ||
      mimeTypes.contentType(path.extname(filePath)) ||
      "application/octet-stream";
    if (typeof logger.debug === "function") {
      logger.debug(`[CACHE HIT] Serving static file: ${filePath}`);
    }
    applyClientCacheControl(headers);

    const content = Buffer.from(cacheEntry.content, "base64");
    let gzipped = null;
    if (cacheEntry.gzipContent) {
      gzipped = Buffer.from(cacheEntry.gzipContent, "base64");
    }
    await sendBody(content, gzipped, headers);
    return true;
  }

  // Static file from disk
  return new Promise((resolve) => {
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
      applyClientCacheControl(outHeaders);

      const gzipped = await gzipBuffer(data);

      if (useCache) {
        const entry = {
          contentType,
          content: data.toString("base64"),
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
};
