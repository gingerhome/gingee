const sql = require('mssql');

/**
 * A class that provides an interface for interacting with a Microsoft SQL Server database.
 * @private
 */
class MssqlAdapter {
    /**
     * @description Initializes the MssqlAdapter with the given configuration.
     * @param {Object} dbConfig - The database configuration object.
     * @param {Object} app - The GingerJS application instance.
     * @param {Object} logger - The logger instance.
     */
    constructor(dbConfig, app, logger) {
        this.logger = logger;
        // The constructor for ConnectionPool needs to be async, so we use a factory pattern.
        // We will store the promise and await it in the methods.
        this.poolPromise = this._createPool(dbConfig);
    }

    /**
     * @description Creates a connection pool for the database.
     * @param {Object} dbConfig - The database configuration object.
     * @returns {Promise<sql.ConnectionPool>} The created connection pool.
     * @throws {Error} If the pool creation fails.
     */
    async _createPool(dbConfig) {
        try {
            const config = {
                user: dbConfig.user,
                password: dbConfig.password,
                server: dbConfig.host,
                database: dbConfig.database,
                port: dbConfig.port || 1433,
                pool: {
                    max: dbConfig.max || 10,
                    min: dbConfig.min || 0,
                    idleTimeoutMillis: dbConfig.idleTimeoutMillis || 30000
                },
                options: {
                    encrypt: dbConfig.encrypt || false,
                    trustServerCertificate: dbConfig.trustServerCertificate || false
                }
            };
            const pool = new sql.ConnectionPool(config);
            await pool.connect();
            this.logger.info(`Initialized MS SQL Server connection pool for: ${dbConfig.database}`);
            return pool;
        } catch (err) {
            this.logger.error(`Failed to create MS SQL pool: ${err.message}`);
            throw err;
        }
    }

    /**
     * Transpiles a SQL query from a generic format to the SQL Server format.
     * @param {string} sqlString - The SQL query string to transpile.
     * @returns {string} The transpiled SQL query string.
     */
    _transpileSql(sqlString) {
        let transpiledSql = sqlString.replace(/"(\w+)"/g, '[$1]');
        transpiledSql = transpiledSql.replace(/\$(\d+)/g, '@p$1');
        return transpiledSql;
    }

    /**
     * @description Prepares a SQL request by adding input parameters.
     * @param {sql.Request} request - The SQL request object.
     * @param {Array} params - The parameters to add to the request.
     */
    _prepareRequest(request, params) {
        if (params && params.length > 0) {
            params.forEach((value, index) => {
                request.input(`p${index + 1}`, value);
            });
        }
    }

    /**
     * @description Executes a SQL query.
     * @param {string} sqlString - The SQL query string to execute.
     * @param {Array} params - The parameters to include in the query.
     * @returns {Promise<Object>} The result of the query.
     */
    async query(sqlString, params = []) {
        try {
            const pool = await this.poolPromise;
            const request = pool.request();
            this._prepareRequest(request, params);
            const result = await request.query(this._transpileSql(sqlString));
            return {
                rows: result.recordset,
                rowCount: result.rowsAffected[0] || result.recordset.length,
            };
        } catch (error) {
            this.logger.error(`MSSQL: query error ${error.message} for SQL: ${sqlString}`, { stack: error.stack });
            throw error;
        }
    }

    /**
     * @description Executes a SQL command that does not return rows (e.g., INSERT, UPDATE, DELETE).
     * @param {string} sqlString - The SQL command to execute.
     * @param {Array} params - The parameters to include in the command.
     * @returns {Promise<number>} The number of rows affected by the command.
     */
    async execute(sqlString, params = []) {
        try {
            const pool = await this.poolPromise;
            const request = pool.request();
            this._prepareRequest(request, params);
            const result = await request.query(this._transpileSql(sqlString));
            return result.rowsAffected[0];
        } catch (error) {
            this.logger.error(`MSSQL: execute error ${error.message} for SQL: ${sqlString}`, { stack: error.stack });
            throw error;
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
        const transaction = new sql.Transaction(pool);
        await transaction.begin();
        try {
            const txClient = {
                query: async (sqlString, params) => {
                    const request = new sql.Request(transaction);
                    this._prepareRequest(request, params);
                    const result = await request.query(this._transpileSql(sqlString));
                    return { rows: result.recordset, rowCount: result.rowsAffected[0] || result.recordset.length };
                },
                execute: async (sqlString, params) => {
                    const request = new sql.Request(transaction);
                    this._prepareRequest(request, params);
                    const result = await request.query(this._transpileSql(sqlString));
                    return result.rowsAffected[0];
                },
            };
            const result = await callback(txClient);
            await transaction.commit();
            return result;
        } catch (err) {
            await transaction.rollback();
            this.logger.error(`MSSQL: transaction error ${err.message}`, { stack: err.stack });
            throw err;
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

module.exports = MssqlAdapter;
