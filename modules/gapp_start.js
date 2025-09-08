const fs = require('fs');
const path = require('path');
const { als, getContext } = require('./ginger.js');
const { runInGBox } = require('./gbox.js');
const engineRoot = path.resolve(__dirname, '..');


/**
 * Reads the central permissions file and attaches the granted permissions
 * to the live, in-memory app object.
 * @param {object} app - The application object from the main `apps` registry.
 * @private
 */
function loadPermissionsForApp(app) {
    const { projectRoot, logger } = getContext();
    const permissionsFilePath = path.join(projectRoot, 'settings', 'permissions.json');
    
    app.grantedPermissions = []; // Default to no permissions

    if (fs.existsSync(permissionsFilePath)) {
        try {
            const allGrants = JSON.parse(fs.readFileSync(permissionsFilePath, 'utf8'));
            if (allGrants[app.name] && Array.isArray(allGrants[app.name].granted)) {
                app.grantedPermissions = allGrants[app.name].granted;
            }
        } catch (e) {
            logger.error(`Error parsing settings/permissions.json for app '${app.name}'. Defaulting to no permissions.`, { error: e.message });
        }
    }
    
    // This log is very useful for debugging permissions on startup/reload.
    logger.info(`Permissions loaded for '${app.name}'. Granted: [${app.grantedPermissions.join(', ') || 'none'}]`);
}

/**
 * Executes the configured startup scripts for a given application.
 * This is an internal function used by the server engine during boot and by the
 * platform module during lifecycle events.
 * @param {object} app - The application object from the main `apps` registry.
 * @private
 */
async function runStartupScripts(app) {
    const { logger, globalConfig } = getContext();

    const scripts = app.config['startup_scripts'];
    if (!scripts || !Array.isArray(scripts) || scripts.length === 0) {
        return; // No startup scripts to run for this app.
    }

    logger.info(`Running ${scripts.length} startup script(s) for app '${app.name}'...`);

    for (const scriptPath of scripts) {
        const fullScriptPath = path.join(app.appBoxPath, scriptPath);
        if (!fs.existsSync(fullScriptPath)) {
            logger.error(`FATAL: Startup script not found: ${scriptPath} for app '${app.name}'. App will not start.`);
            return false;
        }

        try {
            // Establish a non-HTTP context for the app.
            // The ALS store provides the necessary context for modules like db, cache, and log.
            await als.run({ appName: app.name, app, logger: app.logger, globalConfig, scriptPath: fullScriptPath, scriptFolder: path.dirname(fullScriptPath) }, async () => {
                app.logger.info(`Executing startup script: ${scriptPath}`);

                const gBoxConfig = {
                    appName: app.name,
                    app: app,
                    appBoxPath: app.appBoxPath,
                    globalModulesPath: path.join(engineRoot, 'modules'),
                    allowedBuiltinModules: (globalConfig.box && globalConfig.box.allowed_modules) || [],
                    privilegedApps: globalConfig.privileged_apps || [],
                    useCache: true, // Startup script transpilation can be cached
                    logger: app.logger
                };

                const scriptModule = runInGBox(fullScriptPath, gBoxConfig);
                if (typeof scriptModule === 'function') {
                    await scriptModule();
                } else {
                    throw new Error(`Startup script ${scriptPath} in app ${app.name} did not export a function.`);
                }
            });
        } catch (e) {
            logger.error(`FATAL: Error executing startup script '${scriptPath}' for app '${app.name}'. App will not start.`);
            logger.error(e.stack);
            return false;
        }
    }
}

module.exports = { loadPermissionsForApp, runStartupScripts };
