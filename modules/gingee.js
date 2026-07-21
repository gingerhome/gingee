/**
 * @module gingee
 * @description App-facing request middleware: ALS context, gingee(handler), $g.
 *
 * Public API (stable — do not break):
 *   - als
 *   - getContext()
 *   - gingee(handler)
 *
 * Internals live under modules/engine/request_context/ (engine-only; sandbox cannot require).
 */

const { AsyncLocalStorage } = require('async_hooks');
const path = require('path');

const als = new AsyncLocalStorage();

const { initializeGContext } = require('./engine/request_context/build_g.js');
const { parseBodyAndRunHandler } = require('./engine/request_context/body.js');

module.exports = {
  als,
  getContext: () => {
    const store = als.getStore();
    if (!store) {
      throw new Error('No context found');
    }
    return store;
  },
  gingee: async (handler) => {
    const store = als.getStore();
    if (!store) {
      throw new Error(
        "gingee must be called within a request's asynchronous execution context only."
      );
    }

    const isHttpContext = !!(store.req && store.res);

    if (isHttpContext && store.$g && store.$g.isCompleted) {
      store.logger.info(
        `Handler skipped for script '${path.basename(store.scriptPath)}' because response was already sent.`
      );
      return;
    }

    try {
      const { isHttpContext: httpCtx } = initializeGContext(store);

      if (httpCtx) {
        // Body parse + handler (or GET with null body)
        await parseBodyAndRunHandler(store, handler, als);
        return;
      }

      // Non-HTTP context: schedule (fully set in initializeGContext) or startup scripts
      await handler(store.$g);
    } catch (err) {
      if (store && store.logger) {
        store.logger.error(
          `Error in gingee middleware: ${err.message} in app ${store.appName} found in script ${path.basename(store.scriptPath)}`,
          { stack: err.stack }
        );
      } else {
        console.error(
          `Error in gingee middleware: ${err.message} in app ${store.appName} found in script ${path.basename(store.scriptPath)}`,
          { stack: err.stack }
        );
      }
      if (isHttpContext && store.$g && !store.$g.isCompleted) {
        store.res.writeHead(500, { 'Content-Type': 'text/plain' });
        store.res.end(
          `INTERNAL SERVER ERROR - ${err.message} - check logs for more details`
        );
        store.$g.isCompleted = true;
      }
    }
  }
};
