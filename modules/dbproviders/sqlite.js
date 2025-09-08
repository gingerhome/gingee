const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

/**
 * A class that provides an interface for interacting with a SQLite database.
 * @private
 */
class SqliteAdapter {
    /**
     * @description Initializes the SqliteAdapter with the given configuration.
     * @param {Object} dbConfig - The database configuration object.
     * @param {Object} app - The GingerJS application instance.
     * @param {Object} logger - The logger instance.
     */
    constructor(dbConfig, app, logger) {
        const dbFileName = dbConfig.database;
        const dbPath = path.resolve(app.appBoxPath, dbFileName);
        const dbDir = path.dirname(dbPath);

        if (path.isAbsolute(dbFileName)) {
            logger.info(`Db init error for - ${app.name} - Absolute paths are not allowed for SQLite databases. Please use a relative path within the app's box folder.`);
            throw new Error(`RESTRICTED: Attempt to use absolute SQLite db path - ${dbFileName}`);
        }

        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.db = new Database(dbPath);
        this.logger = logger;
    }

    /**
     * Transpiles a PostgreSQL-style query ($1, $2) to a SQLite-style query (?, ?).
     * @private
     */
    _transpile(sql) {
        return sql.replace(/\$(\d+)/g, '?');
    }

    /**
     * Executes a SQL query and returns the result.
     * @param {string} sql - The SQL query to execute.
     * @param {Array} [params=[]] - The parameters for the SQL query.
     * @returns {Promise<Object>} The result of the query.
     * @throws {Error} If the query fails.
     */
    async query(sql, params = []) {
        try {
            if (!this.db) {
                throw new Error("Database connection is not initialized.");
            }
            const stmt = this.db.prepare(this._transpile(sql));
            const rows = stmt.all(params);
            return { rows, rowCount: rows.length };
        } catch (error) {
            this.logger.error(`SQLite: query error ${error.message} for SQL: ${sql}`, { stack: error.stack });
            throw error;
        }
    }

    /**
     * Executes a SQL command that does not return rows (e.g., INSERT, UPDATE, DELETE).
     * @param {string} sql - The SQL command to execute.
     * @param {Array} [params=[]] - The parameters for the SQL command.
     * @returns {number} The number of rows affected by the command.
     * @throws {Error} If the command fails.
     */
    async execute(sql, params = []) {
        try {
            if (!this.db) {
                throw new Error("Database connection is not initialized.");
            }
            const stmt = this.db.prepare(this._transpile(sql));
            return stmt.run(params).changes;
        } catch (error) {
            this.logger.error(`SQLite: execute error ${error.message} for SQL: ${sql}`, { stack: error.stack });
            throw error;
        }
    }

    /**
     * Executes a transaction with multiple queries.
     * @param {function} callback - A function that receives a transaction client object.
     * @returns {Promise<any>} The result of the transaction.
     * @throws {Error} If the transaction fails.
     */
    async transaction(callback) {
        try {
            if (!this.db) {
                throw new Error("Database connection is not initialized.");
            }
            const tx = this.db.transaction(async () => {
                const txClient = {
                    query: (sql, params) => this.query(sql, params),
                    execute: (sql, params) => this.execute(sql, params),
                };
                return await callback(txClient);
            });
            return tx();
        } catch (err) {
            this.logger.error(`SQLite: transaction error ${err.message}`, { stack: err.stack });
            throw err;
        }
    }

    /**
     * Shuts down the database connection.
     * @returns {Promise<void>}
     */
    async shutdown() {
        try {
            if (this.db) this.db.close();
        } catch (err) {
            this.logger.error(`SQLite: shutdown error ${err.message}`, { stack: err.stack });
            throw err;
        }
    }
}

module.exports = SqliteAdapter;
