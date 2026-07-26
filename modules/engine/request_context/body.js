/**
 * @module engine/request_context/body
 * @description HTTP body parsing for gingee() middleware (json, form, multipart, raw).
 * Engine-internal. Behavior must match the pre-extract gingee.js body path exactly
 * except for documented hardening (media-type prefix, oversize destroy + 413).
 */

const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const { formidable } = require('formidable');
const { parseSize } = require('./parse_size.js');

/**
 * First Content-Type header value (Node may give a string or string[]).
 * @param {object} req
 * @returns {string}
 */
function getContentTypeHeader(req) {
  if (!req || !req.headers) return '';
  const ct = req.headers['content-type'];
  if (Array.isArray(ct)) return String(ct[0] || '');
  return ct == null ? '' : String(ct);
}

/**
 * Media type only (type/subtype), lowercased — strips parameters such as charset/boundary.
 * e.g. `application/json; charset=utf-8` → `application/json`
 *
 * @param {string} contentTypeHeader
 * @returns {string}
 */
function parseMediaType(contentTypeHeader) {
  if (contentTypeHeader == null || contentTypeHeader === '') return '';
  const s = String(contentTypeHeader).trim();
  if (!s) return '';
  const semi = s.indexOf(';');
  const raw = semi === -1 ? s : s.slice(0, semi);
  return raw.trim().toLowerCase();
}

/**
 * True when the request likely carries a body (numeric content-length or chunked).
 * @param {object} req
 * @returns {boolean}
 */
function requestLikelyHasBody(req) {
  const te = req.headers && req.headers['transfer-encoding'];
  if (te !== undefined && te !== null && String(te).length > 0) {
    return true;
  }
  const cl = req.headers && req.headers['content-length'];
  if (cl === undefined || cl === null || cl === '') return false;
  const n = Number(Array.isArray(cl) ? cl[0] : cl);
  return Number.isFinite(n) && n > 0;
}

/**
 * Respond 413 Payload Too Large once; mark $g completed.
 * @private
 */
function respondPayloadTooLarge(store) {
  if (!store || !store.res) return;
  if (store.$g && store.$g.isCompleted) return;
  if (store.res.headersSent) {
    if (store.$g) store.$g.isCompleted = true;
    return;
  }
  try {
    store.res.writeHead(413, { 'Content-Type': 'text/plain' });
    store.res.end('Payload Too Large');
  } catch (_) {
    /* response may already be half-closed */
  }
  if (store.$g) store.$g.isCompleted = true;
}

/**
 * Best-effort destroy of the request stream after oversize / fatal parse.
 * @private
 */
function destroyRequest(req) {
  if (!req) return;
  try {
    if (typeof req.destroy === 'function') {
      req.destroy();
    } else if (typeof req.resume === 'function') {
      req.resume();
    }
  } catch (_) {
    /* ignore */
  }
}

/**
 * Run an async function inside ALS and always settle `bodyResolve`.
 * Avoids unhandled rejections from nested `als.run(async …)` (same class as M3).
 * @private
 */
function runInAls(als, store, bodyResolve, fn) {
  const run = () =>
    Promise.resolve()
      .then(() => als.run(store, fn))
      .catch((err) => {
        try {
          if (store && store.logger) {
            store.logger.error(
              `Error processing request body: ${err && err.message ? err.message : err}`,
              { stack: err && err.stack }
            );
          }
        } catch (_) {
          /* ignore */
        }
        if (store && store.$g && !store.$g.isCompleted && store.res && !store.res.headersSent) {
          try {
            store.res.writeHead(500, { 'Content-Type': 'text/plain' });
            store.res.end(
              `INTERNAL SERVER ERROR - ${err && err.message ? err.message : 'error'} - check logs for more details`
            );
            store.$g.isCompleted = true;
          } catch (_) {
            /* ignore */
          }
        }
      })
      .finally(() => {
        try {
          bodyResolve();
        } catch (_) {
          /* ignore */
        }
      });
  run();
}

/**
 * Parse body (if any) and invoke handler with store.$g.
 * Caller must have already set store.$g.request / response via initializeGContext.
 *
 * @param {object} store - ALS store (must include req, res, $g, maxBodySize, logger, scriptPath)
 * @param {function} handler - app script handler($g)
 * @param {object} als - AsyncLocalStorage instance (same as modules/gingee.als)
 * @returns {Promise<void>}
 */
async function parseBodyAndRunHandler(store, handler, als) {
  const req = store.req;

  const contentTypeHeader = getContentTypeHeader(req);
  const mediaType = parseMediaType(contentTypeHeader);

  if (req.method === 'GET' || req.method === 'HEAD' || !mediaType) {
    // body is not present in GET/HEAD, or no Content-Type → skip parse
    store.$g.request.body = null;
    await handler(store.$g);
    return;
  }

  if (!requestLikelyHasBody(req)) {
    store.$g.request.body = null;
    await handler(store.$g);
    return;
  }

  if (store.req.bodyResolved) {
    store.$g.request.body = store.req.body;
    store.$g.log.info(`Body already processed, skipping for ${path.basename(store.scriptPath)}`);
    await handler(store.$g);
    return;
  }

  let bodyResolve = null;
  const reqPromise = new Promise((resolve) => {
    bodyResolve = resolve;
  });

  const maxBodySize = parseSize(store.maxBodySize);

  if (mediaType === 'application/x-www-form-urlencoded') {
    await parseBufferedBody(store, handler, als, req, maxBodySize, bodyResolve, 'urlencoded');
  } else if (mediaType === 'application/json') {
    await parseBufferedBody(store, handler, als, req, maxBodySize, bodyResolve, 'json');
  } else if (mediaType === 'multipart/form-data') {
    await parseMultipart(store, handler, als, req, maxBodySize, bodyResolve);
  } else {
    await parseBufferedBody(store, handler, als, req, maxBodySize, bodyResolve, 'raw');
  }

  await reqPromise; // Wait until the 'end' / settle path finishes
  if (!store.req.bodyResolved) {
    store.req.bodyResolved = true;
  }
}

/**
 * @private
 * @param {'urlencoded'|'json'|'raw'} mode
 */
async function parseBufferedBody(store, handler, als, req, maxBodySize, bodyResolve, mode) {
  const bodyChunks = [];
  let receivedBytes = 0;
  let payloadExceeded = false;
  let settled = false;

  const settle = () => {
    if (settled) return;
    settled = true;
    try {
      bodyResolve();
    } catch (_) {
      /* ignore */
    }
  };

  const onData = (chunk) => {
    if (payloadExceeded || settled) return;

    receivedBytes += chunk.length;

    if (receivedBytes > maxBodySize) {
      payloadExceeded = true;
      bodyChunks.length = 0;
      store.logger.warn(
        `Request body size limit exceeded for ${req.url}. Limit: ${maxBodySize}, Received: ${receivedBytes}`
      );
      respondPayloadTooLarge(store);
      destroyRequest(req);
      // Destroy may skip 'end' on some paths — settle after microtask so any
      // concurrent end handler can observe payloadExceeded first.
      setImmediate(settle);
      return;
    }

    bodyChunks.push(chunk);
  };

  const onEnd = () => {
    if (settled && !payloadExceeded) return;
    if (payloadExceeded) {
      settle();
      return;
    }

    if (store.$g && store.$g.isCompleted) {
      store.logger.info(
        `Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`
      );
      settle();
      return;
    }

    runInAls(als, store, settle, async () => {
      if (payloadExceeded || (store.$g && store.$g.isCompleted)) {
        return;
      }

      if (store.$g.request.body) {
        store.$g.log.info(
          `Body already processed, skipping for ${path.basename(store.scriptPath)}`
        );
        store.req.body = store.$g.request.body;
        await handler(store.$g);
        return;
      }

      if (!bodyChunks || bodyChunks.length === 0) {
        store.$g.request.body = null;
        if (mode === 'urlencoded') {
          store.req.body = store.$g.request.body;
        }
        await handler(store.$g);
        return;
      }

      const requestBody = Buffer.concat(bodyChunks).toString();

      if (mode === 'urlencoded') {
        try {
          store.$g.request.body = querystring.parse(requestBody);
          store.req.body = store.$g.request.body;
          await handler(store.$g);
        } catch (err) {
          store.$g.log.error(
            `Error parsing request body: ${err.message} for ${store.$g.request.path}`
          );
          store.$g.request.body = requestBody;
          store.req.body = store.$g.request.body;
          await handler(store.$g);
        }
      } else if (mode === 'json') {
        try {
          store.$g.request.body = JSON.parse(requestBody);
          await handler(store.$g);
          store.req.body = store.$g.request.body;
        } catch (jsonErr) {
          store.$g.log.error(
            `Error parsing request body: ${jsonErr.message} for ${store.$g.request.path}`
          );
          store.$g.request.body = requestBody;
          store.req.body = store.$g.request.body;
          await handler(store.$g);
        }
      } else {
        // raw
        store.$g.request.body = requestBody;
        store.req.body = store.$g.request.body;
        await handler(store.$g);
      }
    });
  };

  const onError = () => {
    // After destroy for oversize, or client abort — do not hang the ALS waiter.
    if (payloadExceeded || settled) {
      settle();
      return;
    }
    settle();
  };

  req.on('data', onData);
  req.on('end', onEnd);
  req.on('error', onError);
  // close without end (destroyed stream) — ensure we never hang gingee()
  req.on('close', () => {
    if (payloadExceeded || settled) settle();
  });
}

/**
 * @private
 */
async function parseMultipart(store, handler, als, req, maxBodySize, bodyResolve) {
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    try {
      bodyResolve();
    } catch (_) {
      /* ignore */
    }
  };

  try {
    const form = formidable({
      multiples: true,
      keepExtensions: true,
      maxTotalFileSize: maxBodySize
    });

    form.on('error', (err) => {
      // Handle formidable's specific 'maxTotalFileSize' error (code 1009)
      if (err && err.code === 1009) {
        store.logger.warn(`Multipart request size limit exceeded for ${req.url}`);
        respondPayloadTooLarge(store);
        destroyRequest(req);
      }
    });

    form.parse(req, (err, fields, uploadedFiles) => {
      if (store.$g && store.$g.isCompleted) {
        store.logger.info(
          `Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`
        );
        settle();
        return;
      }

      runInAls(als, store, settle, async () => {
        if (err) {
          store.$g.log.error(
            `Error parsing multipart/form-data: ${err.message} for ${store.$g.request.path}`
          );
          if (err.code === 1009) {
            // 413 already sent in form.on('error') when possible
            if (!store.$g.isCompleted) {
              respondPayloadTooLarge(store);
            }
            destroyRequest(req);
            return;
          }
          store.$g.log.info(
            `Error parsing multipart/form-data: ${err.message} for ${store.$g.request.path}`
          );
        }

        if (store.$g.request.body) {
          store.$g.log.info(
            `Body already processed, skipping for ${path.basename(store.scriptPath)}`
          );
          store.req.body = store.$g.request.body;
          await handler(store.$g);
          return;
        }

        const files = {};
        const fileFields = Object.keys(uploadedFiles || {});
        fileFields.forEach((fileField) => {
          const file = uploadedFiles[fileField] && uploadedFiles[fileField][0];
          if (!file) return;
          files[fileField] = {
            name: file.originalFilename,
            type: file.mimetype,
            size: file.size
          };
          // Temp path from formidable — only touch the disk if we have a real string path.
          // (Passing undefined/null to fs.existsSync triggers Node DEP0187.)
          const tempPath =
            typeof file.filepath === 'string' && file.filepath
              ? file.filepath
              : typeof file.path === 'string' && file.path
                ? file.path
                : null;
          if (tempPath && fs.existsSync(tempPath)) {
            const fPath = path.resolve(tempPath);
            const fileBuffer = fs.readFileSync(fPath);
            files[fileField].data = fileBuffer;
          }
        });
        store.$g.request.body = { ...fields, files };
        store.req.body = store.$g.request.body;
        await handler(store.$g);
      });
    });
  } catch (err) {
    if (store && store.logger) {
      store.logger.error(
        `Error processing multipart/form-data: ${err.message} for ${store.$g.request.path}`,
        { stack: err.stack }
      );
    } else {
      console.error(
        `Error processing multipart/form-data: ${err.message} for ${store.$g.request.path}`,
        { stack: err.stack }
      );
    }
    if (store.$g && !store.$g.isCompleted) {
      store.res.writeHead(500, { 'Content-Type': 'text/plain' });
      store.res.end(`INTERNAL SERVER ERROR - ${err.message} - check logs for more details`);
      store.$g.isCompleted = true;
    }
    settle();
  }
}

module.exports = {
  parseBodyAndRunHandler,
  parseMediaType,
  getContentTypeHeader,
  requestLikelyHasBody
};
