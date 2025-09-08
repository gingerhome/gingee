const mysql = require('mysql2/promise');

/**
 * A class that provides an interface for interacting with a MySQL database.
 * @private
 */
class MysqlAdapter {
    /**
     * @description Initializes the PostgresAdapter with the given configuration.
     * @param {Object} dbConfig - The database configuration object.
     * @param {Object} app - The GingerJS application instance.
     * @param {Object} logger - The logger instance.
     */
    constructor(dbConfig, app, logger) {
        this.pool = mysql.createPool({
            host: dbConfig.host,
            user: dbConfig.user,
            password: dbConfig.password,
            database: dbConfig.database,
            port: dbConfig.port || 3306,
            waitForConnections: dbConfig.waitForConnections || true,
            connectionLimit: dbConfig.max || 10,
            queueLimit: dbConfig.queueLimit || 0
        });
        this.logger = logger;
    }

    /**
     * Transpiles a PostgreSQL-style query ($1, $2) to a MySQL-style query (?, ?).
     * @private
     */
    _transpileSql(sql) {
        return sql.replace(/\$\d+/g, '?');
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
            const [rows] = await this.pool.query(this._transpileSql(sql), params);
            return {
                rows: rows,
                rowCount: rows.length,
            };
        } catch (error) {
            this.logger.error(`MySQL: query error ${error.message} for SQL: ${sql}`, { stack: error.stack });
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
            const [result] = await this.pool.execute(this._transpileSql(sql), params);
            return result.affectedRows;
        } catch (error) {
            this.logger.error(`MySQL: execute error ${error.message} for SQL: ${sql}`, { stack: error.stack });
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
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const txClient = {
                query: async (sql, params) => {
                    const [rows] = await connection.query(this._transpileSql(sql), params);
                    return { rows, rowCount: rows.length };
                },
                execute: async (sql, params) => {
                    const [result] = await connection.execute(this._transpileSql(sql), params);
                    return result.affectedRows;
                },
            };
            const result = await callback(txClient);
            await connection.commit();
            return result;
        } catch (err) {
            await connection.rollback();
            this.logger.error(`MySQL: transaction error ${err.message}`, { stack: err.stack });
            throw err;
        } finally {
            connection.release();
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

module.exports = MysqlAdapter;
