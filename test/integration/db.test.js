const { als } = require('../../modules/gingee');
const db = require('../../modules/db');
const appLogger = require('../../modules/logger');
const winston = require('winston');

// Create a dummy logger for the tests
const logger = winston.createLogger({ transports: [new winston.transports.Console({ silent: true })] });
appLogger.init(logger);

// IMPORTANT: These tests require a running PostgreSQL instance
// with credentials configured in `web/tests/box/app.json`.
const app1Config = require('../../web/tests/box/app.json');

describe('db.js - Multi-App Integration', () => {
    let mockApp1, mockApp2;
    let postgresAvailable = false;
    const dbName = 'testpostgresdb'; // The simple name from app.json

    beforeAll(async () => {
        // --- Setup Mock App Contexts ---
        mockApp1 = {
            name: 'app1',
            config: app1Config,
            appBoxPath: '/fake/web/app1/box',
            logger: appLogger.createAppLogger('app1', '/fake/web/app1/box', { level: 'error' })
        };
        mockApp2 = { // A second app, could point to a different database
            name: 'app2',
            config: app1Config, // For this test, it can use the same config
            appBoxPath: '/fake/web/app2/box',
            logger: appLogger.createAppLogger('app2', '/fake/web/app2/box', { level: 'error' })
        };

        // --- Initialize the DB for both "apps" ---
        try {
            db.init(`${dbName}`, app1Config.db[0], mockApp1, logger);
            db.init(`${dbName}`, app1Config.db[0], mockApp2, logger);
            // Probe connectivity
            await als.run({ appName: 'app1', app: mockApp1, logger: mockApp1.logger }, async () => {
                await db.query.one(dbName, 'SELECT 1 as result');
            });
            postgresAvailable = true;
        } catch (e) {
            postgresAvailable = false;
            // eslint-disable-next-line no-console
            console.warn(
                `[db.integration] Skipping live Postgres tests: ${e.message}. ` +
                    `Ensure PostgreSQL is running and database exists (see web/tests/box/app.json).`
            );
            try {
                await db.shutdownApp('app1', logger);
                await db.shutdownApp('app2', logger);
            } catch (_) {
                /* ignore */
            }
        }
    });

    afterAll(async () => {
        if (!postgresAvailable) return;
        await db.shutdownApp('app1', logger);
        await db.shutdownApp('app2', logger);
    });

    test('should execute a query for app1 using its context', async () => {
        if (!postgresAvailable) {
            return; // soft-skip when DB not provisioned
        }
        const mockStore = { appName: 'app1', app: mockApp1, logger: mockApp1.logger };

        let result;
        await als.run(mockStore, async () => {
            result = await db.query.one(dbName, 'SELECT 1 as result');
        });

        expect(result.result).toBe(1);
    });

    test('should execute a query for app2 using its context', async () => {
        if (!postgresAvailable) {
            return;
        }
        const mockStore = { appName: 'app2', app: mockApp2, logger: mockApp2.logger };

        let result;
        await als.run(mockStore, async () => {
            result = await db.query.one(dbName, 'SELECT 2 as result');
        });

        expect(result.result).toBe(2);
    });

    test('should throw an error when a script in app1 tries to access an unknown db name', async () => {
        // This path does not require a live server if init failed — still need mockApp1
        if (!mockApp1) {
            mockApp1 = {
                name: 'app1',
                config: app1Config,
                appBoxPath: '/fake/web/app1/box',
                logger: logger
            };
        }
        // Ensure at least one pool was registered so db module is usable; if not, init a dummy fails on query for missing name
        if (!postgresAvailable) {
            // Unit-style: init with sqlite if available is overkill; just construct error from db without pool for unknown name
            try {
                db.init(dbName, app1Config.db[0], mockApp1, logger);
            } catch (_) {
                /* ignore connection */
            }
        }

        const mockStore = { appName: 'app1', app: mockApp1, logger: mockApp1.logger };

        await expect(
            als.run(mockStore, async () => {
                await db.query.one('non_existent_db', 'SELECT 1');
            })
        ).rejects.toThrow("No DB configured with name 'non_existent_db' for app 'app1'");
    });
});
