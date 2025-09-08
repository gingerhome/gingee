const path = require('path');
const { getContext } = require('./ginger.js');
const dbInstances = new Map();

/**
 * @module db
 * @description Provides a unified interface for database operations, allowing dynamic loading of different database adapters.
 * This module supports multiple database types by loading the appropriate adapter based on configuration.
 * It provides methods for querying, executing commands, and managing transactions. 
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */

/**
 * @private
 * @description Initializes a database adapter for a given configuration.
 * This is called by server.js at startup.
 */
function init(dbName, dbConfig, app, logger) {
    if (!dbConfig.type || !dbConfig.name) {
        throw new Error(`Database config for '${dbName}' is missing the 'type' or 'name' property.`);
    }

    try {
        const AdapterClass = require(path.join(__dirname, 'dbproviders', `${dbConfig.type}.js`));
        const adapterInstance = new AdapterClass(dbConfig, app, logger);
        const dbKey = `${app.name}_${dbConfig.name}`;
        dbInstances.set(dbKey, adapterInstance);
    } catch (e) {
        logger.error(`Failed to load database adapter for app '${app.name}' - '${dbConfig.type}': ${e.message}`);
        throw new Error(`Failed to load/init db adapter for app '${app.name}' - '${dbConfig.type}': ${e.message}`);
    }
}

/**
 * Finds and gracefully shuts down all database connection pools for a specific app.
 * @param {string} appName - The name of the application whose connections to shut down.
 * @private
 */
async function shutdownApp(appName, logger) {
    // Iterate through all known db instances
    try {
        for (const [uniqueDbName, adapter] of dbInstances.entries()) {
            if (uniqueDbName.startsWith(`${appName}_`)) {
                if (adapter && typeof adapter.shutdown === 'function') {
                    await adapter.shutdown();
                    logger.info(`Gracefully shut down db pool for '${uniqueDbName}'.`);
                }
                dbInstances.delete(uniqueDbName);
            }
        }
    } catch (err) {
        logger.error(`Error shutting down db connections for app '${appName}': ${err.message}`);
        throw new Error(`Failed to shut down db connections for app '${appName}': ${err.message}`);
    }
}

/**
 * @private
 * @description Shuts down all database connections for a specific app and re-initializes them.
 * @param {string} appName - The name of the application to re-initialize.
 * @param {object} app - The application object from the main server.
 * @param {object} logger - The logger instance.
 */
async function reinitApp(appName, app, logger) {
    await shutdownApp(appName, logger);
    
    const appDbConfigs = app.config.db || [];
    appDbConfigs.forEach(dbConfig => {
        if (dbConfig.name && dbConfig.type) {
            init(dbConfig.name, dbConfig, app, logger);
        }
    });
}

/**
 * Retrieves the adapter instance for a given dbName.
 * @private
 */
function _getAdapter(simpleDbName) {
    const { appName } = getContext();
    if (!appName) throw new Error("DB module cannot determine app context.");
    
    const uniqueDbName = `${appName}_${simpleDbName}`;
    const adapter = dbInstances.get(uniqueDbName);
    if (!adapter) 
        throw new Error(`No DB configured with name '${simpleDbName}' for app '${appName}'.`);
    return adapter;
}


// --- Public API ---

/** 
 * @function query
 * @memberof module:db
 * @description Executes a SQL query against the specified database.
 * @param {string} dbName The name of the database to query.
 * @param {string} sql The SQL query string.
 * @param {Array} params The parameters for the query.
 * @returns {Promise<Object>} The result of the query.
 * @example
 * const result = await db.query('myDatabase', 'SELECT * FROM users WHERE id = ?', [userId]);
 * console.log(result);
 * @throws {Error} If the database connection is not configured or the query fails.
 * @throws {Error} If the SQL query is invalid or the parameters do not match.
 */
async function query(dbName, sql, params) { 
    return _getAdapter(dbName).query(sql, params); 
}

/**
 * @function query.one
 * @memberof module:db
 * @description Executes a SQL query against the specified database and returns a single result.
 * @param {string} dbName The name of the database to query.
 * @param {string} sql The SQL query string.
 * @param {Array} params The parameters for the query.
 * @returns {Promise<Object|null>} The first row of the result or null if no rows were found.
 * @example
 * const user = await db.query.one('myDatabase', 'SELECT * FROM users WHERE id = ?', [userId]);
 * if (user) {
 *     console.log(`User found: ${user.name}`);
 * } else {
 *     console.log("User not found");
 * }
 * @throws {Error} If the database connection is not configured or the query fails.
 * @throws {Error} If the SQL query is invalid or the parameters do not match.
 */
query.one = async function(dbName, sql, params) {
    const res = await _getAdapter(dbName).query(sql, params);
    return res.rows[0] || null;
};

/**
 * @function query.many
 * @memberof module:db
 * @description Executes a SQL query against the specified database and returns multiple results.
 * @param {string} dbName The name of the database to query.
 * @param {string} sql The SQL query string.
 * @param {Array} params The parameters for the query.
 * @returns {Promise<Array>} An array of rows returned by the query.
 * @example
 * const users = await db.query.many('myDatabase', 'SELECT * FROM users WHERE active = ?', [true]);
 * console.log(`Found ${users.length} active users.`);
 * @throws {Error} If the database connection is not configured or the query fails.
 * @throws {Error} If the SQL query is invalid or the parameters do not match.
 */
query.many = async function(dbName, sql, params) {
    const res = await _getAdapter(dbName).query(sql, params);
    return res.rows;
};

/**
 * @function execute
 * @memberof module:db
 * @description Executes a SQL update/insert/delete command against the specified database.
 * @param {string} dbName The name of the database to execute the command on.
 * @param {string} sql The SQL insert/update/delete command string.
 * @param {Array} params The parameters for the command.
 * @returns {Promise<Object>} The result of the execution, typically containing row count or status.
 * @example
 * const result = await db.execute('myDatabase', 'UPDATE users SET active = ? WHERE id = ?', [false, userId]);
 * console.log(`Rows affected: ${result.rowCount}`);
 * @throws {Error} If the database connection is not configured or the command fails.
 * @throws {Error} If the SQL command is invalid or the parameters do not match.
 */
async function execute(dbName, sql, params) {
    return _getAdapter(dbName).execute(sql, params);
}

/**
 * @function transaction
 * @memberof module:db
 * @description Executes a transaction with the provided callback function.
 * @param {string} dbName The name of the database to use for the transaction.
 * @param {Function} callback The function to execute within the transaction context.
 * @returns {Promise<any>} The result of the transaction callback.
 * @example
 * await db.transaction('myDatabase', async (client) => {
 *     await client.execute('INSERT INTO users (name) VALUES (?)', ['Alice']);
 * });
 * @throws {Error} If the transaction fails or the callback throws an error.
 * @throws {Error} If the database connection is not configured.
 */
async function transaction(dbName, callback) {
    return _getAdapter(dbName).transaction(callback);
}

module.exports = {
    init, // For server.js
    shutdownApp,
    reinitApp,
    query,
    execute,
    transaction
};
