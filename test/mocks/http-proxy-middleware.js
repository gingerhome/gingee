/**
 * CJS mock for ESM-only http-proxy-middleware so Jest can load gingee.js in integration tests.
 */
function createProxyMiddleware() {
  return function proxyMiddleware(req, res, next) {
    if (typeof next === 'function') next();
  };
}

module.exports = {
  createProxyMiddleware,
  debugProxyErrorsPlugin: {},
  errorResponsePlugin: {},
  loggerPlugin: {},
  proxyEventsPlugin: {},
  fixRequestBody: () => {},
  responseInterceptor: () => {}
};
