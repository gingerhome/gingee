/**
 * @module engine/http_servers
 * @description HTTP/HTTPS server create + listen helpers.
 * Engine-internal — not for sandboxed app require.
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const limits = require('../limits.js');

/**
 * @param {Error} error
 * @param {number} port
 * @param {string} [protocol]
 * @param {object} logger
 */
function handleServerError(error, port, protocol, logger) {
  const proto = protocol || 'HTTP';
  if (error.code === 'EADDRINUSE') {
    const message = `FATAL: Port ${port} is already in use. \r\nPlease stop the other process or configure a different port in your gingee.json file.`;
    logger.error(message);
    console.error(message);
  } else {
    const message = `FATAL: Failed to start ${proto} server on port ${port}.`;
    logger.error(message, { error: error.message, stack: error.stack });
    console.error(message);
    console.error(error);
  }
  process.exit(1);
}

/**
 * Start HTTP and/or HTTPS listeners for the given request handler.
 * @param {object} options
 * @param {object} options.config
 * @param {object} options.logger
 * @param {string} options.projectRoot
 * @param {function} options.reqHandler - (req, res) => void
 */
function startHttpServers({ config, logger, projectRoot, reqHandler }) {
  // --- HTTP Server ---
  if (config.server.http.enabled) {
    try {
      const httpServer = http.createServer(reqHandler);
      limits.applyServerTimeouts(httpServer);

      httpServer.on('error', (error) => {
        handleServerError(error, config.server.http.port, 'HTTP', logger);
      });

      httpServer.listen(config.server.http.port, () => {
        const message = `Gingee HTTP server running on port ${config.server.http.port}`;
        logger.info(message);
        console.log(message);
      });
    } catch (err) {
      handleServerError(err, config.server.http.port, 'HTTP', logger);
    }
  }

  // --- HTTPS Server ---
  if (config.server.https.enabled) {
    try {
      const keyPath = path.resolve(projectRoot, config.server.https.key_file);
      const certPath = path.resolve(projectRoot, config.server.https.cert_file);

      logger.info(`Attempting to load SSL key from: ${keyPath}`);
      logger.info(`Attempting to load SSL certificate from: ${certPath}`);

      const options = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath)
      };

      const httpsServer = https.createServer(options, reqHandler);
      limits.applyServerTimeouts(httpsServer);

      httpsServer.on('error', (error) => {
        handleServerError(error, config.server.https.port, 'HTTPS', logger);
      });

      httpsServer.listen(config.server.https.port, () => {
        const message = `Gingee HTTPS server running on port ${config.server.https.port}`;
        logger.info(message);
        console.log(message);
      });
    } catch (err) {
      // This will catch errors like missing SSL cert files
      handleServerError(err, config.server.https.port, 'HTTPS', logger);
    }
  }
}

module.exports = {
  handleServerError,
  startHttpServers
};
