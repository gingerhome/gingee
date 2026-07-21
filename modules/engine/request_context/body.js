/**
 * @module engine/request_context/body
 * @description HTTP body parsing for gingee() middleware (json, form, multipart, raw).
 * Engine-internal. Behavior must match the pre-extract gingee.js body path exactly.
 */

const fs = require('fs');
const path = require('path');
const querystring = require('querystring');
const { formidable } = require('formidable');
const { parseSize } = require('./parse_size.js');

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

  if (req.method === 'GET' || !req.headers['content-type']) {
    //body is not present in GET requests, so we can directly call the handler
    //ignored if it is present
    store.$g.request.body = null;
    await handler(store.$g);
    return;
  }

  const hasBody =
    req.headers['content-length'] > '0' || req.headers['transfer-encoding'] !== undefined;
  if (!hasBody) {
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

  let maxBodySize = parseSize(store.maxBodySize);

  if (req.headers['content-type'] === 'application/x-www-form-urlencoded') {
    await parseBufferedBody(store, handler, als, req, maxBodySize, bodyResolve, 'urlencoded');
  } else if (req.headers['content-type'] === 'application/json') {
    await parseBufferedBody(store, handler, als, req, maxBodySize, bodyResolve, 'json');
  } else if (req.headers['content-type'].indexOf('multipart/form-data') === 0) {
    await parseMultipart(store, handler, als, req, maxBodySize, bodyResolve);
  } else {
    await parseBufferedBody(store, handler, als, req, maxBodySize, bodyResolve, 'raw');
  }

  await reqPromise; // Wait until the 'end' event processing is done
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

  req.on('data', (chunk) => {
    receivedBytes += chunk.length;

    if (payloadExceeded) return;

    if (receivedBytes > maxBodySize) {
      store.logger.warn(
        `Request body size limit exceeded for ${req.url}. Limit: ${maxBodySize}, Received: ${receivedBytes}`
      );
      payloadExceeded = true;
    } else {
      bodyChunks.push(chunk);
    }
  });

  req.on('end', async () => {
    if (store.$g && store.$g.isCompleted) {
      store.logger.info(
        `Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`
      );
      bodyResolve();
      return;
    }

    als.run(store, async () => {
      try {
        if (payloadExceeded) {
          store.$g.request.body = { error: 'Payload size exceeded' };
        }

        if (store.$g.request.body) {
          store.$g.log.info(
            `Body already processed, skipping for ${path.basename(store.scriptPath)}`
          );
          store.req.body = store.$g.request.body;
          await handler(store.$g);
          bodyResolve();
          return;
        }

        if (!bodyChunks || bodyChunks.length === 0) {
          store.$g.request.body = null;
          if (mode === 'urlencoded') {
            store.req.body = store.$g.request.body;
          }
          await handler(store.$g);
          bodyResolve();
          return;
        }

        const requestBody = Buffer.concat(bodyChunks).toString();

        if (mode === 'urlencoded') {
          try {
            store.$g.request.body = querystring.parse(requestBody);
            store.req.body = store.$g.request.body;
            await handler(store.$g);
            bodyResolve();
          } catch (err) {
            store.$g.log.error(
              `Error parsing request body: ${err.message} for ${store.$g.request.path}`
            );
            store.$g.request.body = requestBody;
            store.req.body = store.$g.request.body;
            await handler(store.$g);
            bodyResolve();
          }
        } else if (mode === 'json') {
          try {
            store.$g.request.body = JSON.parse(requestBody);
            await handler(store.$g);
            store.req.body = store.$g.request.body;
            bodyResolve();
          } catch (jsonErr) {
            store.$g.log.error(
              `Error parsing request body: ${jsonErr.message} for ${store.$g.request.path}`
            );
            store.$g.request.body = requestBody;
            store.req.body = store.$g.request.body;
            await handler(store.$g);
            bodyResolve();
          }
        } else {
          // raw
          store.$g.request.body = requestBody;
          store.req.body = store.$g.request.body;
          await handler(store.$g);
          bodyResolve();
        }
      } catch (err) {
        if (store && store.logger) {
          store.logger.error(
            `Error processing request body: ${err.message} for ${store.$g.request.path}`,
            { stack: err.stack }
          );
        } else {
          console.error(
            `Error processing request body: ${err.message} for ${store.$g.request.path}`,
            { stack: err.stack }
          );
        }
        if (mode === 'urlencoded') {
          if (!store.$g.isCompleted) {
            store.res.writeHead(500, { 'Content-Type': 'text/plain' });
            store.res.end(
              `INTERNAL SERVER ERROR - ${err.message} - check logs for more details`
            );
            store.$g.isCompleted = true;
          }
        } else if (store.$g && !store.$g.isCompleted) {
          store.$g.isCompleted = true;
          store.res.writeHead(500, { 'Content-Type': 'text/plain' });
          store.res.end(
            `INTERNAL SERVER ERROR - ${err.message} - check logs for more details`
          );
        }
        bodyResolve();
      }
    });
  });
}

/**
 * @private
 */
async function parseMultipart(store, handler, als, req, maxBodySize, bodyResolve) {
  try {
    const form = formidable({
      multiples: true,
      keepExtensions: true,
      maxTotalFileSize: maxBodySize
    });

    form.on('error', (err) => {
      // Handle formidable's specific 'maxTotalFileSize' error
      if (err.code === 1009) {
        store.logger.warn(`Multipart request size limit exceeded for ${req.url}`);
      }
    });

    form.parse(req, async (err, fields, uploadedFiles) => {
      if (store.$g && store.$g.isCompleted) {
        store.logger.info(
          `Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`
        );
        bodyResolve();
        return;
      }

      als.run(store, async () => {
        try {
          if (err) {
            store.$g.log.error(
              `Error parsing multipart/form-data: ${err.message} for ${store.$g.request.path}`
            );
            if (err.code === 1009) {
              store.$g.request.body = { error: 'Payload limit exceeded' };
              store.req.body = store.$g.request.body;
              await handler(store.$g);
              bodyResolve();
              return;
            } else {
              store.$g.log.info(
                `Error parsing multipart/form-data: ${err.message} for ${store.$g.request.path}`
              );
            }
          }

          if (store.$g.request.body) {
            store.$g.log.info(
              `Body already processed, skipping for ${path.basename(store.scriptPath)}`
            );
            store.req.body = store.$g.request.body;
            await handler(store.$g);
            bodyResolve();
            return;
          }

          var files = {};
          var fileFields = Object.keys(uploadedFiles);
          fileFields.forEach((fileField) => {
            let file = uploadedFiles[fileField] && uploadedFiles[fileField][0];
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
          bodyResolve();
        } catch (err2) {
          if (store && store.logger) {
            store.logger.error(
              `Error processing multipart/form-data: ${err2.message} for ${store.$g.request.path}`,
              { stack: err2.stack }
            );
          } else {
            console.error(
              `Error processing multipart/form-data: ${err2.message} for ${store.$g.request.path}`,
              { stack: err2.stack }
            );
          }
          if (store.$g && !store.$g.isCompleted) {
            store.$g.isCompleted = true;
            store.res.writeHead(500, { 'Content-Type': 'text/plain' });
            store.res.end(
              `INTERNAL SERVER ERROR - ${err2.message} - check logs for more details`
            );
          }
          bodyResolve();
        }
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
    bodyResolve();
  }
}

module.exports = {
  parseBodyAndRunHandler
};
