/**
 * @module engine/logger_setup
 * @description Winston server logger factory.
 * Engine-internal — not for sandboxed app require.
 */

const path = require('path');
const winston = require('winston');
require('winston-daily-rotate-file');

/**
 * Create the main server logger (daily rotate file under project logs/).
 * @param {object} config - resolved gingee config
 * @param {string} projectRoot
 * @returns {import('winston').Logger}
 */
function createServerLogger(config, projectRoot) {
  return winston.createLogger({
    level: config.logging.level,
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [
      new winston.transports.DailyRotateFile({
        filename: path.join(projectRoot, 'logs', 'gingee-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: `${config.logging.rotation.max_size_mb}m`,
        maxFiles: `${config.logging.rotation.period_days}d`
      })
    ]
  });
}

module.exports = {
  createServerLogger
};
