const { Pool } = require('pg');

/**
 * A class that provides an interface for interacting with a PostgreSQL database.
 * @private
 */
class PostgresAdapter {
    /**
     * @description Initializes the PostgresAdapter with the given configuration.
     * @param {Object} dbConfig - The database configuration object.
     * @param {Object} app - The Gingee application instance.
     * @param {Object} logger - The logger instance.
     */
    constructor(dbConfig, app, logger) {
        this.pool = new Pool(dbConfig);
        this.logger = logger;
    }

    /**
     * Executes a SQL query using the connection pool.
     * @param {string} sql - The SQL query to execute.
     * @param {Array} [params=[]] - The parameters for the SQL query.
     * @return {Promise<Object>} The result of the query.
     * @throws {Error} If the query fails or if the pool is not initialized.
     */
    async query(sql, params = []) {
        try {
            const result = await this.pool.query(sql, params);
            return result;
        } catch (error) {
            this.logger.error(`Postgres: query error ${error.message} for SQL: ${sql}`, { stack: error.stack });
            throw error;
        }
    }

    /**
     * Executes a SQL command that does not return rows (e.g., INSERT, UPDATE, DELETE).
     * @param {string} sql - The SQL command to execute.
     * @param {Array} [params=[]] - The parameters for the SQL command.
     * @returns {number} The number of rows affected by the command.
     * @throws {Error} If the command fails or if the pool is not initialized.
     */
    async execute(sql, params = []) {
        try {
            const result = await this.pool.query(sql, params);
            return result.rowCount;
        } catch (error) {
            this.logger.error(`Postgres: execute error ${error.message} for SQL: ${sql}`, { stack: error.stack });
            throw error;
        }
    }

    /** 
     * @description This function allows you to perform multiple queries within a transaction.
     * @param {function} callback - A function that receives a transaction client object.
     * @returns {Promise<any>} The result of the transaction.
     * @throws {Error} If the transaction fails or if the pool is not initialized.
     */
    async transaction(callback) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const txClient = {
                query: (sql, params) => client.query(sql, params),
                execute: async (sql, params) => (await client.query(sql, params)).rowCount,
            };
            const result = await callback(txClient);
            await client.query('COMMIT');
            return result;
        } catch (err) {
            await client.query('ROLLBACK');
            this.logger.error(`Postgres: transaction error ${err.message}`, { stack: err.stack });
            throw err;
        } finally {
            client.release();
        }
    }

    /**
     * Shuts down the database connection pool.
     * @returns {Promise<void>}
     */
    async shutdown() {
        if (this.pool) {
            await this.pool.end();
        }
    }
}

module.exports = PostgresAdapter;
