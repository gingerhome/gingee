// IMPORTANT: This module uses the NATIVE 'fs' module for privileged access.
const nodeFs = require('fs');
const nodeFsPromises = require('fs/promises');
const path = require('path');

const yauzl = require('yauzl');
const archiver = require('archiver');
const fg = require('fast-glob');
const zip = require('./zip.js');
const { als, getContext } = require('./gingee.js');
const db = require('./db.js');
const appLogger = require('./logger.js');

const { match } = require('path-to-regexp');
const { loadPermissionsForApp, runStartupScripts } = require('./gapp_start.js');

const ALL_PERMISSIONS = {
    "cache": "Allows the app to use the caching service for storing and retrieving data.",
    "db": "Allows the app to connect to and query the database(s) you configure for it.",
    "fs": "Grants full read/write access within the app's own secure directories (`box` and `web`).",
    "httpclient": "Permits the app to make outbound network requests to any external API or website.",
    "platform": "PRIVILEGED: Allows managing the lifecycle of other applications on the server. Grant with extreme caution.",
    "pdf": "Allows the app to generate and manipulate PDF documents.",
    "zip": "Allows the app to create and extract ZIP archives.",
    "image": "Allows the app to manipulate image files."
};

/**
 * @module platform
 * @description A module for Gingee platform-specific utilities and functions. Ideally used by only platform-level apps. 
 * To use this module the app needs to be declared in the `privilegedApps` list in the gingee.json server config.
 * <b>IMPORTANT:</b> Requires privileged app config and explicit permission to use the module. See docs/permissions-guide for more details.
 */


/**
 * Writes the permissions for a specific app to the permissions.json file.
 * @private
 */

async function _writePermissionsToFile(appName, permissionsArray) {
    const { projectRoot, logger } = getContext();
    const permissionsFilePath = path.join(projectRoot, 'settings', 'permissions.json');
    
    let allGrants = {};
    if (nodeFs.existsSync(permissionsFilePath)) {
        allGrants = JSON.parse(nodeFs.readFileSync(permissionsFilePath, 'utf8'));
    }

    // Ensure permissionsArray is a unique set of valid keys
    if (Array.isArray(permissionsArray)) {
        const validPermissions = permissionsArray.filter(p => ALL_PERMISSIONS.hasOwnProperty(p));
        allGrants[appName] = { granted: [...new Set(validPermissions)] }; // Use Set to remove duplicates
    }else{
        allGrants[appName] = { granted: [] };
    }

    nodeFs.writeFileSync(permissionsFilePath, JSON.stringify(allGrants, null, 2));
    logger.info(`Permissions file on disk updated for app '${appName}'.`);

    return allGrants[appName].granted;
}

/**
 * Loads and caches the application configuration.
 * @private 
 */
function _loadAndCacheAppConfig(appConfigPath) {
    // Always purge the cache before reading to get the freshest version
    if (nodeFs.existsSync(appConfigPath) && require.cache[require.resolve(appConfigPath)]) {
        delete require.cache[require.resolve(appConfigPath)];
    }

    let finalConfig = {};
    if (nodeFs.existsSync(appConfigPath)) {
        const userAppConfig = require(appConfigPath);
        const defaultAppConfig = {
            name: "Untitled Gingee App",
            description: "",
            version: "1.0.0",
            type: "MPA",
            db: [],
            "startup_scripts": [],
            "default_include": [],
            env: {},
            jwt_secret: null,
            cache: {
                client: { enabled: false, no_cache_regex: [] },
                server: { enabled: false, no_cache_regex: [] }
            },
            logging: {
                level: "error"
            }
        };

        const appConfig = {
            ...defaultAppConfig,
            ...userAppConfig,
            // Ensure nested objects are also safely merged
            env: { ...defaultAppConfig.env, ...(userAppConfig.env || {}) },
            cache: { ...defaultAppConfig.cache, ...(userAppConfig.cache || {}) }
        };

        finalConfig = appConfig;
    }

    return finalConfig;
}


/**
 * Securely resolves a path for a target app, ensuring it stays within that app's directory.
 * @private
 */
function _resolveSecureAppPath(appName, filePath) {
    const { webPath, logger } = getContext();
    const appDir = path.join(webPath, appName);

    if (!nodeFs.existsSync(appDir)) {
        throw new Error(`Application '${appName}' does not exist.`);
    }

    const appBasePath = appDir;
    let finalFilePath = filePath;

    if (filePath.startsWith('/')) {
        const pathSegments = filePath.split('/').filter(Boolean);
        const firstSegment = pathSegments[0];

        // If the path starts with the target app's name, strip it for convenience.
        // e.g., writeFile('app1', '/app1/box/file.txt') -> 'box/file.txt'
        if (firstSegment === appName) {
            finalFilePath = path.join(...pathSegments.slice(1));
        } else {
            // If it starts with just '/', treat it as relative to the app's web root.
            finalFilePath = filePath.substring(1);
        }
    }

    const targetPath = path.join(appBasePath, finalFilePath);

    const resolvedPath = path.resolve(targetPath);
    if (!resolvedPath.startsWith(appBasePath)) {
        logger.error(`Path Traversal Error: Attempted access to '${filePath}' is outside of app '${appName}' directory.`);
        throw new Error(`Path Traversal Error: Access is forbidden.`);
    }
    return resolvedPath;
}

/**
 * Securely unzips a buffer to an absolute destination path on the filesystem.
 * It validates every entry to prevent path traversal attacks.
 * @param {Buffer} zipBuffer - The zip data as a buffer.
 * @param {string} destAbsolutePath - The absolute path to the destination directory.
 * @returns {Promise<boolean>} A promise that resolves to true if the unzip was successful.
 * @private
 */
async function _unzipBufferToPath(zipBuffer, destAbsolutePath) {
    // Ensure the base directory exists
    nodeFs.mkdirSync(destAbsolutePath, { recursive: true });

    const zipfile = await new Promise((resolve, reject) => {
        yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zf) => err ? reject(err) : resolve(zf));
    });

    await new Promise((resolve, reject) => {
        zipfile.on('error', reject);
        zipfile.on('end', resolve);
        zipfile.on('entry', (entry) => {
            const finalDestPath = path.join(destAbsolutePath, entry.fileName);
            const resolvedPath = path.resolve(finalDestPath);

            if (!resolvedPath.startsWith(destAbsolutePath)) {
                return reject(new Error(`Security Error: Zip file contains path traversal ('${entry.fileName}').`));
            }

            if (/\/$/.test(entry.fileName)) { // Directory entry
                nodeFs.mkdirSync(resolvedPath, { recursive: true });
                zipfile.readEntry();
            } else { // File entry
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) return reject(err);
                    nodeFs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
                    const writeStream = nodeFs.createWriteStream(resolvedPath);
                    readStream.on('error', reject);
                    writeStream.on('error', reject);
                    writeStream.on('finish', () => zipfile.readEntry());
                    readStream.pipe(writeStream);
                });
            }
        });
        zipfile.readEntry();
    });
    return true; // Indicate success
}

/**
 * A private helper to scan a zip buffer and extract file lists and manifests.
 * @private
 * @param {Buffer} packageBuffer - The zip data as a buffer.
 */
async function _scanPackage(packageBuffer) {
    const zipfile = await new Promise((resolve, reject) => yauzl.fromBuffer(packageBuffer, { lazyEntries: true }, (err, zf) => err ? reject(err) : resolve(zf)));

    const packageFiles = [];
    let gupConfig = null;
    let appConfig = null;

    await new Promise((resolve, reject) => {
        zipfile.on('error', reject);
        zipfile.on('end', resolve);
        zipfile.on('entry', (entry) => {
            packageFiles.push(entry.fileName.replace(/\\/g, '/'));
            const fileName = entry.fileName.replace(/\\/g, '/');

            if (fileName === 'box/.gup' || fileName === 'box/app.json') {
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) return reject(err);
                    const chunks = [];
                    readStream.on('data', chunk => chunks.push(chunk));
                    readStream.on('end', () => {
                        try {
                            const config = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                            if (fileName === 'box/.gup') gupConfig = config;
                            if (fileName === 'box/app.json') appConfig = config;
                            zipfile.readEntry();
                        } catch (e) { reject(e); }
                    });
                });
            } else {
                zipfile.readEntry();
            }
        });
        zipfile.readEntry();
    });

    return { packageFiles, gupConfig, appConfig };
}

/**
 * Creates an upgrade plan for an app based on the package buffer.
 * @private
 * @param {string} appName - The name of the app to upgrade.
 */
async function _createUpgradePlan(appName, packageBuffer) {
    const { allApps } = getContext();
    const app = allApps[appName];
    if (!app) throw new Error(`Target app '${appName}' does not exist.`);

    const liveAppFiles = await fg('**/*', { cwd: app.appWebPath, dot: true, stats: false });
    const liveAppVersion = app.config.version || 'N/A';

    const { packageFiles, gupConfig, appConfig } = await _scanPackage(packageBuffer);
    const preserveRules = (gupConfig && gupConfig.preserve) ? gupConfig.preserve : [];
    const packageVersion = (appConfig && appConfig.version) ? appConfig.version : 'N/A';

    const preservedFiles = preserveRules.length > 0
        ? await fg(preserveRules, { cwd: app.appWebPath, dot: true, stats: false })
        : [];

    const liveFileSet = new Set(liveAppFiles);
    const packageFileSet = new Set(packageFiles);
    const preservedFileSet = new Set(preservedFiles);

    const deleted = liveAppFiles.filter(f => !packageFileSet.has(f) && !preservedFileSet.has(f));
    const added = packageFiles.filter(f => !liveFileSet.has(f));
    const overwritten = liveAppFiles.filter(f => packageFileSet.has(f) && !preservedFileSet.has(f));

    return {
        appName: appName,
        action: 'Upgrade',
        fromVersion: liveAppVersion,
        toVersion: packageVersion,
        files: { preserved: preservedFiles, added, overwritten, deleted }
    };
}

/**
 * Reloads the routes for a specific application.
 * @private
 * @param {string} appName - The name of the app to reload routes for.
 */
async function _reloadRoutes(appName) {
    const { allApps, logger } = getContext();
    const app = allApps[appName];
    if (!app) return; // Silently fail if app doesn't exist in this context

    const routesPath = path.join(app.appBoxPath, 'routes.json');

    // Purge old routes.json from Node's require cache
    if (nodeFs.existsSync(routesPath) && require.cache[require.resolve(routesPath)]) {
        delete require.cache[require.resolve(routesPath)];
    }

    if (nodeFs.existsSync(routesPath)) {
        try {
            const routesConfig = require(routesPath);
            const compiledRoutes = [];
            if (routesConfig && routesConfig.routes) {
                for (const route of routesConfig.routes) {
                    compiledRoutes.push({
                        method: route.method ? route.method.toUpperCase() : 'GET',
                        script: route.script,
                        matcher: match(route.path, { decode: decodeURIComponent })
                    });
                }
            }
            app.compiledRoutes = compiledRoutes;
            logger.info(`Routes for '${appName}' reloaded. ${compiledRoutes.length} routes active.`);
        } catch (e) {
            logger.error(`Failed to reload routes for app '${appName}': ${e.message}`);
            app.compiledRoutes = []; // Clear routes on error to ensure a safe state
        }
    } else {
        app.compiledRoutes = []; // No routes file, so no routes
    }
}


/**
 * @function listApps
 * @memberof module:platform
 * @description Lists the names of all detected applications.
 * @returns {Array<string>} An array of app names.
 * @example
 * const platform = require('platform');
 * const apps = platform.listApps();
 * console.log(apps); // ['app1', 'app2', ...]
 */
function listApps() {
    // To get the app list, we need the central `apps` object.
    // The cleanest way is to pass it via the context.
    const ctx = getContext();
    const apps = ctx.allApps ? Object.keys(ctx.allApps) : [ctx.appName]; // Fallback to the current app if not set
    return apps;
}

/**
 * @function createAppDirectory
 * @memberof module:platform
 * @description Creates a new application directory structure.
 * @param {string} appName - The name of the new app to create.
 * @returns {object} An object confirming the paths created.
 * @throws {Error} If the app name is invalid or if the app already exists.
 * @example
 * const result = platform.createAppDirectory('newApp');
 * console.log(result); // { message: 'App "newApp" created successfully.', appPath: '/path/to/newApp', boxPath: '/path/to/newApp/box' }
 */
function createAppDirectory(appName) {
    const { webPath } = getContext();
    if (!appName || !/^[a-zA-Z0-9_-]+$/.test(appName)) {
        throw new Error("Invalid app name provided.");
    }

    const appBasePath = path.join(webPath, appName);
    if (nodeFs.existsSync(appBasePath)) {
        throw new Error(`Application folder '${appName}' already exists.`);
    }

    // Create the full directory structure
    const boxPath = path.join(appBasePath, 'box');
    const webFolders = ['css', 'images', 'scripts', 'libs'];

    nodeFs.mkdirSync(boxPath, { recursive: true });
    webFolders.forEach(folder => {
        nodeFs.mkdirSync(path.join(appBasePath, folder), { recursive: true });
    });

    return {
        message: `App '${appName}' created successfully.`,
        appPath: appBasePath,
        boxPath: boxPath
    };
}

/**
 * @function writeFile
 * @memberof module:platform
 * @description Writes content to a file within a specified app's directory.
 * @param {string} appName - The target application.
 * @param {string} relativePath - The path within the app (e.g., 'box/api/test.js').
 * @param {string|Buffer} content - The content to write.
 * @returns {boolean} True if the file was written successfully.
 * @throws {Error} If the app does not exist or if the path is invalid.
 * @example
 * const result = platform.writeFile('myApp', 'box/api/test.js', 'console.log("Hello World");');
 * console.log(result); // true
 */
function writeFile(appName, relativePath, content) {
    const absolutePath = _resolveSecureAppPath(appName, relativePath);
    // Ensure the directory exists before writing.
    const dir = path.dirname(absolutePath);
    nodeFs.mkdirSync(dir, { recursive: true });
    nodeFs.writeFileSync(absolutePath, content);
    return true;
}

/**
 * @function readFile
 * @memberof module:platform
 * @description Reads the content of a file from a specified app's directory.
 * @param {string} appName - The target application.
 * @param {string} relativePath - The path of the file to read.
 * @param {string|null} [encoding='utf8'] - The encoding to use. Pass null for a raw Buffer.
 * @returns {string|Buffer} The content of the file.
 * @throws {Error} If the app does not exist or if the file does not exist.
 * @example
 * const content = platform.readFile('myApp', 'box/api/test.js');
 * console.log(content); // 'console.log("Hello World");'
 */
function readFile(appName, relativePath, encoding = 'utf8') {
    const absolutePath = _resolveSecureAppPath(appName, relativePath);
    if (!nodeFs.existsSync(absolutePath)) {
        throw new Error(`File not found at ${appName}/${relativePath}`);
    }
    return nodeFs.readFileSync(absolutePath, { encoding });
}

/**
 * @function registerNewApp
 * @memberof module:platform
 * @description Registers a new application in the server's context.
 * @param {string} appName - The name of the app to register.
 * @returns {object} Confirmation message and paths.
 * @throws {Error} If the app already exists or if the name is invalid.
 * @example
 * const result = platform.registerNewApp('myApp');
 * console.log(result); // true if registered successfully
 */
async function registerNewApp(appName, permissionsArray) {
    const { allApps, webPath, logger, globalConfig } = getContext();
    if (allApps[appName]) throw new Error("App already registered.");

    const appWebPath = path.join(webPath, appName);
    const appBoxPath = path.join(appWebPath, 'box');
    const appConfigPath = path.join(appBoxPath, 'app.json');

    // Add the new app to the server's live 'apps' object
    const appConfig = _loadAndCacheAppConfig(appConfigPath);
    const dedicatedLogger = appLogger.createAppLogger(appName, appBoxPath, appConfig.logging);
    const app = { name: appName, config: appConfig, appWebPath, appBoxPath, logger: dedicatedLogger, in_maintenance: false };

    allApps[appName] = app;

    const grantedPermissions = await _writePermissionsToFile(appName, permissionsArray);
    allApps[appName].grantedPermissions = grantedPermissions;
    
    try {
        _reloadRoutes(appName);

        await db.reinitApp(appName, app, logger);

        await als.run({ app, logger, globalConfig }, async () => {
            await runStartupScripts(app);
        });
    } catch (error) {
        logger.error(`Error initializing app '${appName}': ${error.message}`);
        return false;
    }

    logger.info(`App '${appName}' registered successfully.`);
    return true;
}

/**
 * @function reloadApp
 * @memberof module:platform
 * @description Reloads an application's configuration and clears its caches.
 * @param {string} appName - The app to reload.
 * @returns {boolean} True if the app was reloaded successfully.
 * @throws {Error} If the app does not exist.
 * @example
 * const result = platform.reloadApp('myApp');
 * console.log(result); // true if reloaded successfully
 */
async function reloadApp(appName) {
    const { allApps, webPath, transpileCache, staticFileCache, logger, globalConfig } = getContext();
    if (!allApps[appName]) {
        throw new Error(`Cannot reload: App '${appName}' does not exist.`);
    }

    const app = allApps[appName];
    try {
        app.in_maintenance = true;
        logger.info(`App '${appName}' is now in maintenance mode.`);

        // 1. Reload app.json
        const appWebPath = path.join(webPath, appName);
        const appBoxPath = path.join(appWebPath, 'box');
        const appConfigPath = path.join(appBoxPath, 'app.json');
        app.config = _loadAndCacheAppConfig(appConfigPath);
        app.logger = appLogger.createAppLogger(appName, app.appBoxPath, app.config.logging);

        // 2. Load permissions for the app
        loadPermissionsForApp(app);

        // 3. Clear local script cache associated with this app
        const appPathPrefix = app.appBoxPath;
        for (const key of transpileCache.keys()) {
            if (key.startsWith(appPathPrefix)) {
                transpileCache.delete(key);
            }
        }

        // 4. clear static file cache associated with this app
        const staticCachePrefix = `static:${app.appWebPath}`;
        await staticFileCache.clear(staticCachePrefix);

        // 5. Reload routes for this app
        _reloadRoutes(appName);

        // 6. Re-initialize the DB for this app
        await db.reinitApp(appName, app, logger);

        // 7. Run startup scripts for this app
        await als.run({ app, logger, globalConfig }, async () => {
            await runStartupScripts(app);
        });
    } catch (error) {
        logger.error(`Error reloading app '${appName}': ${error.message}`);
        return false;
    } finally {
        if (app.in_maintenance) {
            app.in_maintenance = false;
        }
    }

    logger.info(`App '${appName}' reloaded successfully.`);
    return true; // Indicate success
}

/**
 * @function deleteApp
 * @memberof module:platform
 * @description Recursively deletes an entire application directory. This is a destructive action.
 * @param {string} appName - The name of the app to delete.
 * @returns {boolean} True if the app was deleted successfully.
 * @throws {Error} If the app does not exist or if the deletion is outside the
 * web root.
 * @example
 * const result = platform.deleteApp('myApp');
 * console.log(result); // true if deleted successfully
 */
async function deleteApp(appName) {
    const { allApps, webPath, staticFileCache, transpileCache, logger } = getContext();
    let app = allApps[appName];
    if (!app) {
        throw new Error(`Cannot delete: App '${appName}' does not exist or is not registered.`);
    }

    try{
        app.in_maintenance = true;
        logger.info(`App '${appName}' is now in maintenance mode.`);

        logger.info(`Shutting down logger for app '${appName}' before deletion.`);
        await appLogger.shutdownApp(appName);

        logger.info(`Shutting down database connections for app '${appName}' before deletion.`);
        await db.shutdownApp(appName, logger);

        logger.info(`Revoking permissions for '${appName}'...`);
        removeAppPermissions(appName);

        const appBasePath = app.appWebPath;
        const appConfigPath = path.join(app.appBoxPath, 'app.json');

        // Final safety check to ensure we're not deleting something outside the web root
        if (!path.resolve(appBasePath).startsWith(path.resolve(webPath))) {
            throw new Error(`Security Error: Cannot delete directory outside of the web root.`);
        }

        logger.info(`Deleting app directory: ${appBasePath}`);
        nodeFs.rmSync(appBasePath, { recursive: true, force: true });

        // Remove from the live app registry
        logger.info(`Removing app '${appName}' from app registry.`);
        delete allApps[appName];


        logger.info('Purging require, transpile and static file caches for app: ', appName);
        if (require.cache[require.resolve(appConfigPath)]) {
            delete require.cache[require.resolve(appConfigPath)];
            logger.info(`Purged require cache for: ${appConfigPath}`);
        }

        // 1. Clear transpilation cache for all files within the app's box folder.
        for (const key of transpileCache.keys()) {
            if (key.startsWith(app.appBoxPath)) {
                transpileCache.delete(key);
            }
        }

        // 2. Clear static file cache for all files within the app's web folder.
        await staticFileCache.clear(`static:${app.appWebPath}`);

        logger.info(`App '${appName}' deleted successfully.`);
    } finally {
        // `reloadApp` will set the flag back to false. This is a safety net in case of an early error.
        if (app.in_maintenance) {
            app.in_maintenance = false;
            logger.info(`App '${appName}' has been taken out of maintenance mode due to an error.`);
        }
    }

    return true; // Indicate success
}

/**
 * @function unzipToApp
 * @memberof module:platform
 * @description Unzips a buffer into a target folder within an app, validating each entry for security.
 * @param {string} appName - The target application.
 * @param {string} relativePath - The folder within the app to extract to.
 * @param {Buffer} zipBuffer - The zip data as a buffer.
 * @returns {Promise<boolean>} A promise that resolves to true if the unzip was successful.
 * @throws {Error} If the app does not exist or if the zip contains invalid paths.
 * @example
 * const result = await platform.unzipToApp('myApp', 'uploads', zipBuffer);
 * console.log(result); // true if unzipped successfully
 */
async function unzipToApp(appName, relativePath, zipBuffer) {
    const { allApps, logger } = getContext();
    if (!allApps[appName]) {
        throw new Error(`Cannot unzip: App '${appName}' does not exist.`);
    }

    const destAbsolutePath = _resolveSecureAppPath(appName, relativePath);

    // yauzl.fromBuffer is much more efficient than writing a temp file.
    const zipfile = await new Promise((resolve, reject) => {
        yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
            if (err) reject(err);
            else resolve(zipfile);
        });
    });

    await new Promise((resolve, reject) => {
        zipfile.on('error', reject);
        zipfile.on('end', resolve);

        zipfile.on('entry', (entry) => {
            // For each entry, construct its final destination path.
            const finalDestPath = path.join(destAbsolutePath, entry.fileName);

            // --- CRITICAL SECURITY CHECK ---
            // Resolve the path to process any malicious '..' segments from the zip file.
            const resolvedPath = path.resolve(finalDestPath);

            // Verify that the final resolved path is still INSIDE our secure destination directory.
            if (!resolvedPath.startsWith(destAbsolutePath)) {
                const securityError = new Error(`Security Error: Zip file contains a path traversal attempt ('${entry.fileName}').`);
                return reject(securityError);
            }
            // --- END SECURITY CHECK ---

            // If the entry is a directory, create it.
            if (/\/$/.test(entry.fileName)) {
                nodeFs.mkdirSync(resolvedPath, { recursive: true });
                zipfile.readEntry(); // Move to the next entry
            } else {
                // If the entry is a file, open a read stream from the zip
                // and a write stream to the filesystem.
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) return reject(err);

                    // Ensure the parent directory exists before writing the file.
                    nodeFs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
                    const writeStream = nodeFs.createWriteStream(resolvedPath);

                    readStream.on('error', reject);
                    writeStream.on('error', reject);
                    writeStream.on('finish', () => {
                        zipfile.readEntry(); // Move to the next entry once this one is done
                    });

                    readStream.pipe(writeStream);
                });
            }
        });

        // Start processing the first entry.
        zipfile.readEntry();
    });

    logger.info(`Content unzipped to folder ${relativePath} in App '${appName}' unzipped successfully.`);
    return true;
}

/**
 * @function zipApp
 * @memberof module:platform
 * @description Zips an entire application's directory and returns the data as a buffer.
 * @param {string} appName - The name of the app to zip.
 * @returns {Promise<Buffer>} A promise that resolves with the zip file data.
 * @throws {Error} If the app does not exist or if the zipping fails.
 * @example
 * const zipBuffer = await platform.zipApp('myApp');
 * console.log(zipBuffer); // The zipped app data
 */
async function zipApp(appName) {
    const { allApps, logger } = getContext();
    if (!allApps[appName]) {
        throw new Error(`Cannot zip: App '${appName}' does not exist.`);
    }
    const appInfo = allApps[appName];

    const archive = require('archiver')('zip', { zlib: { level: 9 } });
    const buffers = [];
    archive.on('data', buffer => buffers.push(buffer));

    const streamPromise = new Promise((resolve, reject) => {
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', reject);
    });

    archive.directory(appInfo.appWebPath, appName); // Add the whole folder, with a root directory
    await archive.finalize();

    logger.info(`App '${appName}' zipped successfully.`);
    return streamPromise;
}

/**
 * @function packageApp
 * @memberof module:platform
 * @description Packages an entire application into a distributable .gin archive buffer.
 * Obeys the rules in the app's .gpkg manifest file if it exists.
 * @param {string} appName - The name of the app to package.
 * @returns {Promise<Buffer>} A promise that resolves with the .gin file data.
 * @throws {Error} If the app does not exist or if the packaging fails.
 * @example
 * const packageBuffer = await platform.packageApp('myApp');
 * console.log(packageBuffer); // The packaged app data
 */
async function packageApp(appName) {
    const { allApps } = getContext();
    const app = allApps[appName];
    if (!app) {
        throw new Error(`Cannot package: App '${appName}' does not exist.`);
    }

    const appWebPath = app.appWebPath;
    const appBoxPath = app.appBoxPath;
    const manifestPath = path.join(appBoxPath, '.gpkg');

    let filesToInclude = [];
    let globOptions = {
        cwd: appWebPath,
        onlyFiles: true,
        dot: true // Include dotfiles
    };

    if (nodeFs.existsSync(manifestPath)) {
        const manifest = JSON.parse(nodeFs.readFileSync(manifestPath, 'utf8'));
        const includePatterns = manifest.include || ['**/*'];
        globOptions.ignore = manifest.exclude || [];

        filesToInclude = await fg(includePatterns, globOptions);
    } else {
        // --- SAFER DEFAULT BEHAVIOR ---
        // If no manifest, still exclude common unwanted directories.
        globOptions.ignore = [
            'node_modules/**',
            '.git/**'
        ];
        filesToInclude = await fg(['**/*'], globOptions);
    }

    // --- Create the Archive ---
    const archive = archiver('zip', { zlib: { level: 9 } });
    const buffers = [];
    archive.on('data', buffer => buffers.push(buffer));

    const streamPromise = new Promise((resolve, reject) => {
        archive.on('end', () => resolve(Buffer.concat(buffers)));
        archive.on('error', reject);
    });


    // Add each file from the filtered list to the archive
    for (const file of filesToInclude) {
        const filePath = path.join(appWebPath, file);
        archive.file(filePath, { name: file }); // 'name' preserves the relative path
    }

    await archive.finalize();
    return streamPromise;
}

/**
 * @function mockUpgrade
 * @memberof module:platform
 * @description Mocks an upgrade plan for an app based on a package buffer.
 * This is a utility function for verifying an app upgrade deployment before it happens.
 * @param {string} appName - The name of the app to upgrade.
 * @param {Buffer} packageBuffer - The .gin file content as a buffer.
 * @returns {Promise<object>} A promise that resolves with the upgrade plan.
 * @throws {Error} If the app does not exist or if the package buffer is invalid
 * or contains security issues.
 * @example
 * const upgradePlan = await platform.mockUpgrade('myApp', zipBuffer);
 * console.log(upgradePlan); // { action: 'Upgrade', fromVersion: '1.0.0', toVersion: '2.0.0', files: { preserved: [], added: [], overwritten: [], deleted: [] } }
 */
async function mockUpgrade(appName, packageBuffer) {
    return _createUpgradePlan(appName, packageBuffer);
}

/**
 * @function listBackups
 * @memberof module:platform
 * @description Lists all backups for a specific application.
 * Backups are stored in the 'backups' directory under the project root.
 * @param {string} appName - The name of the application to list backups for.
 * @returns {Array<string>} An array of backup file names sorted by date (newest first).
 * @throws {Error} If the app does not exist or if the backups directory is inaccessible.
 * @example
 * const backups = platform.listBackups('myApp');
 * console.log(backups);
 */
function listBackups(appName) {
    const { projectRoot } = getContext();
    const backupDir = path.join(projectRoot, 'backups', appName);
    if (!nodeFs.existsSync(backupDir)) return [];
    return nodeFs.readdirSync(backupDir)
        .filter(f => f.endsWith('.gin'))
        .sort()
        .reverse(); // Sort descending so the newest is first
}

/**
 * @function mockRollback
 * @memberof module:platform
 * @description Mocks a rollback plan for an app based on the latest backup.
 * This is a utility function for verifying an app rollback deployment before it happens.
 * @param {string} appName - The name of the app to rollback.
 * @returns {Promise<object>} A promise that resolves with the rollback plan.
 * @throws {Error} If the app does not exist or if there are no backups available.
 * @example
 * const rollbackPlan = await platform.mockRollback('myApp');
 * console.log(rollbackPlan); // { action: 'Rollback', fromVersion: '2.0.0', toVersion: '1.0.0', files: { preserved: [], added: [], overwritten: [], deleted: [] } }
 */
async function mockRollback(appName) {
    const backups = listBackups(appName);
    if (backups.length === 0) throw new Error(`No backups found for app '${appName}'.`);

    const { projectRoot } = getContext();
    const latestBackupPath = path.join(projectRoot, 'backups', appName, backups[0]);
    const backupBuffer = nodeFs.readFileSync(latestBackupPath);

    const plan = await _createUpgradePlan(appName, backupBuffer);
    plan.action = 'Rollback';
    return plan;
}

/**
 * @function installApp
 * @memberof module:platform
 * @description Installs a new application from a .gin package buffer into a new directory.
 * Fails if an app with the same name already exists.
 * @param {string} appName - The name of the app to create/install.
 * @param {Buffer} packageBuffer - The .gin file content as a buffer.
 * @param {object} permissions - Permissions to set for the new app.
 * @returns {Promise<object>} A promise that resolves with a success message.
 * @throws {Error} If the app already exists or if the installation fails.
 * @example
 * const grantedPermissions = ["cache", "db", "fs"];
 * const result = await platform.installApp('myApp', packageBuffer, grantedPermissions);
 * console.log(result); // true if installed successfully
 */
async function installApp(appName, packageBuffer, grantedPermissions) {
    const { allApps, webPath, logger } = getContext();

    // Pre-flight Check: Ensure the app does not already exist.
    if (allApps[appName]) {
        throw new Error(`Installation failed: An app named '${appName}' already exists.`);
    }

    // Securely extract the contents
    const appDestPath = path.join(webPath, appName);
    await _unzipBufferToPath(packageBuffer, appDestPath);

    // Register the new app to make it live.
    await registerNewApp(appName, grantedPermissions);

    // Set permissions for the new app.
    //await setAppPermissions(appName, grantedPermissions, false); //set reload app to false as it is a new install

    logger.info(`App '${appName}' installed successfully from package.`);
    return true; // Indicate success
}

/**
 * @function upgradeApp
 * @memberof module:platform
 * @description Upgrades an existing application to a new version using a .gin package buffer.
 * Preserves files as specified in the app's .gup configuration.
 * @param {string} appName - The name of the app to upgrade.
 * @param {Buffer} packageBuffer - The .gin file content as a buffer.
 * @param {object} permissions - Permissions to set for the upgraded app.
 * @param {object} [options={ backup: true }] - Options for the upgrade process.
 * @returns {Promise<boolean>} A promise that resolves to true if the upgrade was successful.
 * @throws {Error} If the app does not exist or if the upgrade fails.
 * @example
 * const grantedPermissions = ["cache", "db", "fs"];
 * const result = await platform.upgradeApp('myApp', packageBuffer, grantedPermissions);
 * console.log(result); // true if upgraded successfully
 */
async function upgradeApp(appName, packageBuffer, grantedPermissions, options = { backup: true }) {
    const { projectRoot, allApps, logger } = getContext();
    const app = allApps[appName];
    if (!app) {
        throw new Error('Application does not registered');
    }

    try {
        app.in_maintenance = true;
        logger.info(`App '${appName}' is now in maintenance mode.`);
        
        const plan = await _createUpgradePlan(appName, packageBuffer);
        // 1. Backup
        if (options.backup) {
            const backupDir = path.join(projectRoot, 'backups', appName);
            if (!nodeFs.existsSync(backupDir)) nodeFs.mkdirSync(backupDir, { recursive: true });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupFileName = `${appName}_v${app.config.version}_${timestamp}.gin`;
            const backupPackage = await packageApp(appName);
            nodeFs.writeFileSync(path.join(backupDir, backupFileName), backupPackage);
        }

        // 2. Surgical Upgrade
        const tempBackupDir = path.join(projectRoot, 'temp', `backup-${appName}-${Date.now()}`);
        if (plan.files.preserved.length > 0) {
            nodeFs.mkdirSync(tempBackupDir, { recursive: true });
            for (const file of plan.files.preserved) {
                const source = path.join(allApps[appName].appWebPath, file);
                const dest = path.join(tempBackupDir, file);
                await nodeFsPromises.mkdir(path.dirname(dest), { recursive: true });
                await nodeFsPromises.rename(source, dest);
            }
        }

        await deleteApp(appName);
        await installApp(appName, packageBuffer, grantedPermissions);

        if (plan.files.preserved.length > 0) {
            for (const file of plan.files.preserved) {
                const source = path.join(tempBackupDir, file);
                const dest = path.join(allApps[appName].appWebPath, file);
                await nodeFsPromises.mkdir(path.dirname(dest), { recursive: true });
                await nodeFsPromises.rename(source, dest);
            }
            nodeFs.rmSync(tempBackupDir, { recursive: true, force: true });
        }

        logger.info(`App '${appName}' upgraded successfully from version ${plan.fromVersion} to ${plan.toVersion}.`);
    } finally {
        if (app.in_maintenance) {
            app.in_maintenance = false;
            logger.info(`App '${appName}' has been taken out of maintenance mode due to an error.`);
            console.log(`Finally logic - ${app.in_maintenance}`);
        }
    }

    return true; // Indicate success
}

/**
 * @function rollbackApp
 * @memberof module:platform
 * @description Rolls back an application to its previous version using the latest backup.
 * @param {string} appName - The name of the app to rollback.
 * @param {Array<string>} grantedPermissions - The permissions granted to the app.
 * @returns {Promise<boolean>} A promise that resolves to true if the rollback was successful.
 * @throws {Error} If the app does not exist or if the rollback fails.
 * @example
 * const result = await platform.rollbackApp('myApp');
 * console.log(result); // true if rolled back successfully
 */
async function rollbackApp(appName, grantedPermissions) {
    const backups = listBackups(appName);
    if (backups.length === 0) throw new Error(`No backups found for app '${appName}'.`);

    const { projectRoot, logger } = getContext();
    const latestBackupFile = backups[0];
    const latestBackupPath = path.join(projectRoot, 'backups', appName, latestBackupFile);
    const backupBuffer = nodeFs.readFileSync(latestBackupPath);

    await upgradeApp(appName, backupBuffer, grantedPermissions, { backup: false }); // Don't re-backup when rolling back

    // Delete the used backup file
    nodeFs.unlinkSync(latestBackupPath);

    logger.info(`App '${appName}' rolled back successfully using backup '${latestBackupFile}'.`);
    return true; // Indicate success
}

/**
 * @function installFromBackup
 * @memberof module:platform
 * @description Installs an application from a previously created backup file.
 * @param {string} appName - The name of the application to install.
 * @param {string} [backupVersion='latest'] - The specific backup file to use, or 'latest' for the most recent.
 * @returns {Promise<object>} A promise that resolves with a success message.
 * @throws {Error} If the app does not exist, if no backups are found, or if the backup file is missing.
 * @example
 * const result = await platform.installFromBackup('myApp');
 * console.log(result); // true if installed successfully
 */
async function installFromBackup(appName, backupVersion = 'latest') {
    const { projectRoot, logger, allApps } = getContext();
    let grantedPermissions = [];
    if(allApps[appName] && allApps[appName].grantedPermissions) {
        grantedPermissions = allApps[appName].grantedPermissions;
    }
    const backups = listBackups(appName);

    if (backups.length === 0) {
        throw new Error(`Installation failed: No backups found for app '${appName}'.`);
    }

    let backupFileToUse;
    if (backupVersion === 'latest') {
        backupFileToUse = backups[0];
    } else {
        backupFileToUse = backups.find(b => b === backupVersion);
    }

    if (!backupFileToUse) {
        throw new Error(`Installation failed: Backup version '${backupVersion}' not found for app '${appName}'.`);
    }

    const backupFilePath = path.join(projectRoot, 'backups', appName, backupFileToUse);
    if (!nodeFs.existsSync(backupFilePath)) {
        throw new Error(`Installation failed: Backup file is missing from the filesystem at ${backupFilePath}`);
    }

    logger.info(`Installing app '${appName}' from backup: ${backupFileToUse}`);

    // Read the backup file into a buffer
    const packageBuffer = nodeFs.readFileSync(backupFilePath);

    // Delegate the actual installation to our existing, secure installApp function.
    return installApp(appName, packageBuffer, grantedPermissions);
}

/**
 * @function getAppPermissions
 * @description Retrieves the permissions for a specific application.
 * @param {string} appName - The name of the application.
 * @returns {Promise<object>} A promise that resolves with the app's permissions.
 * @throws {Error} If the app is not found.
 */
async function getAppPermissions(appName) {
    const { allApps } = getContext();
    const app = allApps[appName];
    if (!app) {
        throw new Error(`App '${appName}' not found.`);
    }

    return {
        allPermissions: ALL_PERMISSIONS,
        grantedPermissions: app.grantedPermissions || []
    };
}

/**
 * @function setAppPermissions
 * @description Sets the permissions for a specific application.
 * @param {string} appName - The name of the application.
 * @param {Array<string>} permissionsArray - The permissions to set.
 * @param {boolean} [reload=true] - Whether to reload the app after setting permissions.
 * @returns {Promise<object>} A promise that resolves with a success message.
 * @throws {Error} If the app is not found.
 */
async function setAppPermissions(appName, permissionsArray) {
    /*const permissionsFilePath = path.join(projectRoot, 'settings', 'permissions.json');

    let allGrants = {};
    if (nodeFs.existsSync(permissionsFilePath)) {
        allGrants = JSON.parse(nodeFs.readFileSync(permissionsFilePath, 'utf8'));
    }

    // Ensure permissionsArray is a unique set of valid keys
    if (Array.isArray(permissionsArray)) {
        const validPermissions = permissionsArray.filter(p => ALL_PERMISSIONS.hasOwnProperty(p));
        allGrants[appName] = { granted: [...new Set(validPermissions)] }; // Use Set to remove duplicates
    }else{
        allGrants[appName] = { granted: [] };
    }

    nodeFs.writeFileSync(permissionsFilePath, JSON.stringify(allGrants, null, 2));
    logger.info(`Permissions file updated for app '${appName}'.`);

    // Reload the app to apply the new permissions context immediately only for permission updates and upgrades, not for new install
    if (reload) {
        await reloadApp(appName);
    } else {
        allApps[appName].grantedPermissions = allGrants[appName].granted; // Update in-memory representation
    }*/

    _writePermissionsToFile(appName, permissionsArray);
    await reloadApp(appName);

    return true;
}

/**
 * @function removeAppPermissions
 * @description Removes all permissions for a specific application.
 * @param {string} appName - The name of the application.
 * @returns {Promise<boolean>} A promise that resolves with a success message.
 */
function removeAppPermissions(appName) {
    const { projectRoot, logger } = getContext();
    const permissionsFilePath = path.join(projectRoot, 'settings', 'permissions.json');
    if (nodeFs.existsSync(permissionsFilePath)) {
        try {
            const allGrants = JSON.parse(nodeFs.readFileSync(permissionsFilePath, 'utf8'));
            if (allGrants[appName]) {
                delete allGrants[appName];
                nodeFs.writeFileSync(permissionsFilePath, JSON.stringify(allGrants, null, 2));
                logger.info(`Permissions for '${appName}' removed from settings/permissions.json.`);
            }
        } catch (err) {
            // Log the error but don't halt the deletion process.
            logger.error(`Could not update permissions file during deletion of '${appName}'. Please check settings/permissions.json manually.`, { error: err.message });
        }
    }
}

/**
 * @function analyzeAppBackup
 * @description Analyzes the backup of a specific application.
 * @param {string} appName - The name of the application.
 * @returns {Promise<object>} - A promise that resolves with the analysis results.
 * @throws {Error} If the app is not found or the backup is invalid.
 */
async function analyzeAppBackup(appName) {
    const { projectRoot, logger } = getContext();
    const backups = listBackups(appName);
    if (backups.length === 0) {
        throw new Error(`No backups found for app '${appName}'.`);
    }

    const latestBackupPath = path.join(projectRoot, 'backups', appName, backups[0]);
    logger.info(`Analyzing backup file: ${latestBackupPath}`);
    const backupBuffer = nodeFs.readFileSync(latestBackupPath);

    // Use yauzl to read manifests from the zip buffer without fully unpacking
    const zipfile = await new Promise((resolve, reject) => yauzl.fromBuffer(backupBuffer, { lazyEntries: true }, (err, zf) => err ? reject(err) : resolve(zf)));
    let pmft = null;
    let appJson = null;

    await new Promise((resolve, reject) => {
        zipfile.on('error', reject);
        zipfile.on('end', () => {
            if (!pmft || !appJson) {
                reject(new Error(`Backup for '${appName}' is invalid or missing required manifest files.`));
            } else {
                resolve();
            }
        });
        zipfile.on('entry', (entry) => {
            const fileName = entry.fileName.replace(/\\/g, '/');
            if (fileName === 'box/pmft.json' || fileName === 'box/app.json') {
                zipfile.openReadStream(entry, (err, readStream) => {
                    if (err) return reject(err);
                    const chunks = [];
                    readStream.on('data', chunk => chunks.push(chunk));
                    readStream.on('end', () => {
                        try {
                            const jsonStr = Buffer.concat(chunks).toString('utf8');
                            const config = JSON.parse(jsonStr);
                            if (fileName === 'box/pmft.json') pmft = config;
                            if (fileName === 'box/app.json') appJson = config;
                            // Optimization: if we've found both, we can stop reading the rest of the zip.
                            if (pmft && appJson) {
                                zipfile.close();
                                resolve();
                            } else {
                                zipfile.readEntry();
                            }
                        } catch (e) { reject(e); }
                    });
                });
            } else {
                zipfile.readEntry();
            }
        });
        zipfile.readEntry();
    });

    return {
        permissions: pmft.permissions,
        version: appJson.version || 'N/A'
    };
}

module.exports = {
    listApps,
    createAppDirectory,
    writeFile,
    readFile,
    registerNewApp,
    reloadApp,
    deleteApp,
    unzipToApp,
    zipApp,
    packageApp,
    listBackups,
    analyzeAppBackup,
    getAppPermissions,
    setAppPermissions,
    installApp,
    installFromBackup,
    upgradeApp,
    mockUpgrade,
    rollbackApp,
    mockRollback
};
