/**
 * @module engine/request/static
 * @description Serve static files with optional cache + gzip.
 * Engine-internal.
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const mimeTypes = require('mime-types');

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
    headers
  } = opts;

  if (!path.extname(filePath)) {
    return false;
  }

  const serverCacheConfig = cacheConfig.server;
  let useCache = serverCacheConfig.enabled;
  const cacheKey = `static:${filePath}`;

  let cacheEntry;
  if (useCache) {
    const isNoCachePath = serverCacheConfig.no_cache_regex.some((r) =>
      new RegExp(r).test(req.url)
    );
    if (isNoCachePath) {
      useCache = false;
      logger.info(`No-cache rule matched for path: ${req.url}`);
    } else {
      cacheEntry = await cache.get(cacheKey);
    }
  }

  if (useCache && cacheEntry) {
    headers['Content-Type'] =
      cacheEntry.contentType ||
      mimeTypes.contentType(path.extname(filePath)) ||
      'application/octet-stream';
    logger.info(`[CACHE HIT] Serving static file: ${filePath}`);

    if (
      cacheConfig.client.enabled &&
      !cacheConfig.client.no_cache_regex.some((r) => new RegExp(r).test(req.url))
    ) {
      headers['Cache-Control'] = 'public, max-age=31536000';
    }

    const content = Buffer.from(cacheEntry.content, 'base64');
    if (canCompress) {
      zlib.gzip(content, (err, compressedData) => {
        if (err) {
          res.writeHead(200, headers);
          res.end(content);
        } else {
          headers['Content-Encoding'] = 'gzip';
          res.writeHead(200, headers);
          res.end(compressedData);
        }
      });
    } else {
      res.writeHead(200, headers);
      res.end(content);
    }
    return true;
  }

  // Static file from disk
  return new Promise((resolve) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('FILE_NOT_FOUND');
        resolve(true);
        return;
      }
      const ext = path.extname(filePath);
      const contentType = mimeTypes.contentType(ext) || 'application/octet-stream';
      const outHeaders = { 'Content-Type': contentType };

      if (useCache) {
        cache.set(cacheKey, { contentType, content: data.toString('base64') });
        logger.info(`[CACHE SET] Caching static file: ${filePath}`);
      }

      if (
        cacheConfig.client.enabled &&
        !cacheConfig.client.no_cache_regex.some((r) => new RegExp(r).test(req.url))
      ) {
        outHeaders['Cache-Control'] = 'public, max-age=31536000';
      } else {
        outHeaders['Cache-Control'] = 'no-store';
      }

      if (canCompress) {
        zlib.gzip(data, (err2, compressedData) => {
          if (err2) {
            res.writeHead(200, outHeaders);
            res.end(data);
          } else {
            outHeaders['Content-Encoding'] = 'gzip';
            res.writeHead(200, outHeaders);
            res.end(compressedData);
          }
          resolve(true);
        });
      } else {
        res.writeHead(200, outHeaders);
        res.end(data);
        resolve(true);
      }
    });
  });
}

/**
 * Directory index redirect or 404.
 */
function serveDirectoryOr404(res, filePath, urlWithoutQuery, queryString) {
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    const indexPath = path.join(filePath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.writeHead(301, {
        Location: `${urlWithoutQuery}/index.html${queryString}`
      });
      res.end();
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('FILE_NOT_FOUND');
    }
    return true;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('FILE_NOT_FOUND');
  return true;
}

module.exports = {
  serveStaticFile,
  serveDirectoryOr404
};
