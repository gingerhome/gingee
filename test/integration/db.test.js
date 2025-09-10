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
    const dbName = 'testpostgresdb'; // The simple name from app.json

    beforeAll(() => {
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
        // server.js would normally do this
        db.init(`${dbName}`, app1Config.db[0], mockApp1, logger);
        db.init(`${dbName}`, app1Config.db[0], mockApp2, logger);
    });
    
    afterAll(async () => {
        // Clean up the connection pools
        await db.shutdownApp('app1', logger);
        await db.shutdownApp('app2', logger);
    });

    test('should execute a query for app1 using its context', async () => {
        const mockStore = { appName: 'app1', app: mockApp1, logger: mockApp1.logger };
        
        let result;
        await als.run(mockStore, async () => {
            // Developer calls with the simple name 'testpostgresdb'
            result = await db.query.one(dbName, 'SELECT 1 as result');
        });
        
        expect(result.result).toBe(1);
    });
    
    test('should execute a query for app2 using its context', async () => {
        const mockStore = { appName: 'app2', app: mockApp2, logger: mockApp2.logger };
        
        let result;
        await als.run(mockStore, async () => {
            result = await db.query.one(dbName, 'SELECT 2 as result');
        });
        
        expect(result.result).toBe(2);
    });
    
    test('should throw an error when a script in app1 tries to access an unknown db name', async () => {
        const mockStore = { appName: 'app1', app: mockApp1, logger: mockApp1.logger };
        
        // We expect this entire async block to throw an error.
        await expect(als.run(mockStore, async () => {
            await db.query.one('non_existent_db', 'SELECT 1');
        })).rejects.toThrow("No DB configured with name 'non_existent_db' for app 'app1'");
    });
});
