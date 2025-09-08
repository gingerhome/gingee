const oracledb = require('oracledb');

/**
 * A class that provides an interface for interacting with an Oracle database.
 * @private
 */
class OracleAdapter {
    /**
     * @description Initializes the OracleAdapter with the given configuration.
     * @param {Object} dbConfig - The database configuration object.
     * @param {Object} app - The GingerJS application instance.
     * @param {Object} logger - The logger instance.
     */
    constructor(dbConfig, app, logger) {
        this.logger = logger;
        this.poolPromise = this._createPool(dbConfig);
        // This setting tells the driver how to format query results.
        oracledb.outFormat = oracledb.OUT_FORMAT_ARRAY;
    }

    /**
     * @description Creates a connection pool for the database.
     * @param {Object} dbConfig - The database configuration object.
     * @returns {Promise<oracledb.Pool>} The created connection pool.
     * @throws {Error} If the pool creation fails.
     */
    async _createPool(dbConfig) {
        try {
            const config = {
                user: dbConfig.user,
                password: dbConfig.password,
                connectString: dbConfig.connectString, // e.g., "localhost:1521/XEPDB1"
            };
            const pool = await oracledb.createPool(config);
            this.logger.info(`Initialized OracleDB connection pool.`);
            return pool;
        } catch (err) {
            this.logger.error("Error initializing OracleDB pool. Is the Instant Client configured?", err);
            throw err;
        }
    }

    /**
     * @description Transpiles a SQL query from a generic format to the Oracle format.
     * @param {string} sqlString - The SQL query string to transpile.
     * @returns {string} The transpiled SQL query string.
     */
    _transpileSql(sqlString) {
        return sqlString.replace(/\$(\d+)/g, ':$1');
    }

    /**
     * @description Normalizes the rows returned from the database.
     * @param {Array} rows - The rows to normalize.
     * @param {Array} metaData - The metadata for the rows.
     * @returns {Array} The normalized rows.
     */
    _normalizeRows(rows, metaData) {
        if (!rows || !metaData) return [];
        const columnNames = metaData.map(col => col.name);
        return rows.map(row => {
            const normalizedRow = {};
            columnNames.forEach((name, index) => {
                const camelCaseName = name.toLowerCase().replace(/_([a-z])/g, g => g[1].toUpperCase());
                normalizedRow[camelCaseName] = row[index];
            });
            return normalizedRow;
        });
    }

    /**
     * @description Executes a SQL statement.
     * @param {oracledb.Connection} connection - The database connection.
     * @param {string} sqlString - The SQL statement to execute.
     * @param {Array} params - The parameters for the SQL statement.
     * @param {Object} options - Additional options for the execution.
     * @returns {Promise<Object>} The result of the execution.
     */
    async _execute(connection, sqlString, params = [], options = {}) {
        return connection.execute(this._transpileSql(sqlString), params, options);
    }

    /**
     * @description Executes a SQL query.
     * @param {string} sqlString - The SQL query string to execute.
     * @param {Array} params - The parameters to include in the query.
     * @returns {Promise<Object>} The result of the query.
     */
    async query(sqlString, params = []) {
        const pool = await this.poolPromise;
        let connection;
        try {
            connection = await pool.getConnection();
            const result = await this._execute(connection, sqlString, params);
            return {
                rows: this._normalizeRows(result.rows, result.metaData),
                rowCount: result.rows ? result.rows.length : 0,
            };
        } catch (error) {
            this.logger.error(`OracleDB: query error ${error.message} for SQL: ${sqlString}`, { stack: error.stack });
            throw error;
        } finally {
            if (connection) await connection.close();
        }
    }

    /**
     * @description Executes a SQL command that does not return rows (e.g., INSERT, UPDATE, DELETE).
     * @param {string} sqlString - The SQL command to execute.
     * @param {Array} params - The parameters to include in the command.
     * @returns {Promise<number>} The number of rows affected by the command.
     */
    async execute(sqlString, params = []) {
        const pool = await this.poolPromise;
        let connection;
        try {
            connection = await pool.getConnection();
            const result = await this._execute(connection, sqlString, params, { autoCommit: true });
            return result.rowsAffected;
        } catch (error) {
            this.logger.error(`OracleDB: execute error ${error.message} for SQL: ${sqlString}`, { stack: error.stack });
            throw error;
        } finally {
            if (connection) await connection.close();
        }
    }

    /**
     * @description Executes a transaction with multiple queries.
     * @param {function} callback - A function that receives a transaction client object.
     * @returns {Promise<any>} The result of the transaction.
     * @throws {Error} If the transaction fails.
     */
    async transaction(callback) {
        const pool = await this.poolPromise;
        let connection;
        try {
            connection = await pool.getConnection();
            connection.autoCommit = false;
            const txClient = {
                query: async (sql, params) => {
                    const result = await this._execute(connection, sql, params);
                    return { rows: this._normalizeRows(result.rows, result.metaData), rowCount: result.rows ? result.rows.length : 0 };
                },
                execute: async (sql, params) => {
                    const result = await this._execute(connection, sql, params);
                    return result.rowsAffected;
                },
            };
            const result = await callback(txClient);
            await connection.commit();
            return result;
        } catch (err) {
            if (connection) await connection.rollback();
            this.logger.error(`OracleDB: transaction error ${err.message}`, { stack: err.stack });
            throw err;
        } finally {
            if (connection) await connection.close();
        }
    }

    /**
     * @description Shuts down the database connection pool.
     * @returns {Promise<void>}
     */
    async shutdown() {
        if (this.poolPromise) {
            const pool = await this.poolPromise;
            if(pool) await pool.close();
        }
    }
}

module.exports = OracleAdapter;
