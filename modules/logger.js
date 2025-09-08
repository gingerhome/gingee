const winston = require('winston');
const path = require('path');
const nodeFs = require('fs');
require('winston-daily-rotate-file');

let serverLogger; // This will hold a reference to the main server logger
let appLoggers = new Map();

/**
 * Initializes the logger module with the main server logger instance.
 * @param {winston.Logger} mainLogger - The main server logger.
 * @private
 */
function init(mainLogger) {
    serverLogger = mainLogger;
}

/**
 * A custom Winston transport to forward logs to the main server logger.
 * @private
 */
class ForwardingTransport extends winston.Transport {
    log(info, callback) {
        setImmediate(() => this.emit('logged', info));
        // Pass the log entry directly to the serverLogger
        serverLogger.log(info);
        callback();
    }
}

/**
 * Creates a dedicated logger for a specific application.
 * @param {string} appName - The name of the application.
 * @param {string} appBoxPath - The absolute path to the app's box folder.
 * @param {object} loggingConfig - The logging level config from ginger.json
 * @returns {winston.Logger} A new logger instance for the app.
 * @private
 */
function createAppLogger(appName, appBoxPath, loggingConfig) {
    if (!serverLogger) {
        throw new Error("Logger module has not been initialized with the main server logger.");
    }

    const logDir = path.join(appBoxPath, 'logs');
    // Ensure the log directory exists
    if (!nodeFs.existsSync(logDir)) {
        nodeFs.mkdirSync(logDir, { recursive: true });
    }

    // A custom format to add the appName to every log message.
    const textFormatForServerLog = winston.format.printf(({ level, message, timestamp, app, ...meta }) => {
        // We get 'app' from defaultMeta, and 'timestamp' is added by the parent logger automatically.
        // We only need to construct the core message string here.
        return `[${app}] ${level}: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    });

    loggingConfig = loggingConfig || { level: 'error' }; // Default to 'error' if not provided

    const newAppLogger = winston.createLogger({
        level: loggingConfig.level,
        defaultMeta: { app: appName }, // Automatically add the app name
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.json()
        ),
        transports: [
            // Transport 1: Write to the app's specific log file.
            new winston.transports.DailyRotateFile({
                filename: path.join(logDir, 'app-%DATE%.log'),
                datePattern: 'YYYY-MM-DD',
                zippedArchive: true,
                maxSize: '20m', // Sensible default for app logs
                maxFiles: '7d'
            }),
            // Transport 2: Forward the log to the main server logger.
            new ForwardingTransport({
                // This transport gets the simple, readable text format.
                // The main server logger will add its own timestamp.
                format: winston.format.combine(
                    winston.format.splat(),
                    textFormatForServerLog
                )
            })
        ]
    });
    appLoggers.set(appName, newAppLogger);
    return newAppLogger;
}

/**
 * Gracefully shuts down and removes the logger for a specific app.
 * @param {string} appName - The name of the application.
 * @private
 */
async function shutdownApp(appName) {
    if (appLoggers.has(appName)) {
        const loggerInstance = appLoggers.get(appName);

        loggerInstance.close();

        // Wrap setImmediate in a Promise. This yields to the event loop,
        // allowing the I/O for closing the file handle to be processed.
        // It's a clean way to say "wait for the next turn of the event loop".
        await new Promise(resolve => setImmediate(resolve));

        appLoggers.delete(appName);
    }
}

module.exports = {
    init,
    createAppLogger,
    shutdownApp
};
