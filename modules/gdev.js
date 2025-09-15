const { spawn } = require('child_process');
const { getContext } = require('./gingee');

/**
 * Stops a running dev server process for a given app.
 * @param {object} app - The application object.
 * @private
 */
function stopDevServer(app) {
    if (app && app.devServerProcess) {
        const { logger } = getContext();
        logger.info(`[SPA Dev] Stopping dev server for '${app.name}'...`);
        process.kill(app.devServerProcess.pid, 'SIGKILL');
        app.devServerProcess = null;
    }
}

/**
 * Starts a dev server process for a given SPA in development mode.
 * @param {object} app - The application object.
 * @private
 */
function startDevServer(app) {
    const { logger } = getContext();

    // Ensure any existing process is stopped before starting a new one.
    stopDevServer(app);

    if (!app || app.config.type !== 'SPA' || app.config.mode !== 'development') {
        return;
    }

    if (app.config.spa && app.config.spa.dev_server_proxy) {
        logger.info(`[SPA Dev] Starting dev server for '${app.name}'...`);
        const devServer = spawn('npm', ['run', 'dev'], {
            cwd: app.appWebPath,
            stdio: 'pipe',
            shell: true
        });

        app.devServerProcess = devServer;

        devServer.stdout.on('data', (data) => logger.info(`[${app.name}-dev]: ${data.toString().trim()}`));
        devServer.stderr.on('data', (data) => logger.error(`[${app.name}-dev]: ${data.toString().trim()}`));
        devServer.on('close', (code) => logger.warn(`[SPA Dev] Dev server for '${app.name}' exited with code ${code}.`));
    }
}

module.exports = {
    startDevServer,
    stopDevServer
};
