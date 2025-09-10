const fs = require('fs-extra');
const path = require('path');
const { als } = require('../../modules/gingee');
const platform = require('../../modules/platform');
const appLogger = require('../../modules/logger');
const { transpileCache } = require('../../modules/gbox');
const { loadPermissionsForApp } = require('../../modules/gapp_start');

// Mock the dependencies of the platform module
jest.mock('../../modules/db', () => ({
    // Mock reinitApp and shutdownApp to be async functions, as they are now in the real module
    reinitApp: jest.fn().mockResolvedValue(true),
    shutdownApp: jest.fn().mockResolvedValue(true),
}));
const db = require('../../modules/db');

jest.mock('../../modules/logger');

describe('platform.js - App Lifecycle Integration', () => {
    const testWorkspace = path.resolve(__dirname, '..', 'workspace');
    const appName = 'lifecycle_test_app';
    const appWebPath = path.join(testWorkspace, 'web', appName);
    const appBoxPath = path.join(appWebPath, 'box');
    const appConfigPath = path.join(appBoxPath, 'app.json');

    let mockAlsStore;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        // Create a clean workspace for each test
        fs.ensureDirSync(testWorkspace);

        const mockPermissionsFile = path.join(testWorkspace, 'settings', 'permissions.json');
        fs.mkdirSync(path.dirname(mockPermissionsFile), { recursive: true });
        fs.writeJsonSync(mockPermissionsFile, {
            "test_app": {
                "granted": ["fs", "db"]
            },
            "glide": {
                "granted": ["platform"]
            },
            "app1": {
                "granted": ["db"]
            },
            "app2": {
                "granted": ["db"]
            }
        });

        // Mock the return values of our dependencies
        jest.clearAllMocks();

        mockAlsStore = {
            webPath: path.join(testWorkspace, 'web'),
            projectRoot: testWorkspace,
            logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
            allApps: {}, // Start with an empty app registry
            transpileCache: transpileCache, // The real transpile cache
            staticFileCache: { clear: jest.fn() } // Mock the distributed cache
        };
    });

    afterEach(() => {
        // Clean up the workspace
        fs.removeSync(testWorkspace);
        transpileCache.clear();
    });

    test('should create, register, reload, and delete an app correctly', async () => {
        // Run the entire test within a single ALS context
        await als.run(mockAlsStore, async () => {
            // 1. Create
            platform.createAppDirectory(appName);
            expect(fs.existsSync(appBoxPath)).toBe(true);

            // Create a dummy app.json for the test
            fs.writeJsonSync(appConfigPath, { name: appName, version: '1.0.0' });

            // 2. Register
            await platform.registerNewApp(appName, ['db']);
            expect(mockAlsStore.allApps[appName]).toBeDefined();
            expect(mockAlsStore.allApps[appName].config.version).toBe('1.0.0');
            
            expect(mockAlsStore.allApps[appName].grantedPermissions).toEqual(['db']);
            expect(mockAlsStore.allApps[appName].config.version).toBe('1.0.0');

            // Verify that the DB re-init function was called during registration
            expect(db.reinitApp).toHaveBeenCalledWith(appName, expect.any(Object), expect.any(Object));


            // 3. Reload
            // Modify the app.json on disk to simulate a change
            fs.writeJsonSync(appConfigPath, { name: appName, version: '2.0.0' });
            jest.resetModules();

            await platform.reloadApp(appName);

            expect(mockAlsStore.allApps[appName].grantedPermissions).toEqual(['db']);
            expect(mockAlsStore.allApps[appName].config.version).toBe('2.0.0');
            // Verify DB re-init was called again on reload
            expect(db.reinitApp).toHaveBeenCalledTimes(2); //as we have reset modules earlier

            // 4. Delete
            await platform.deleteApp(appName);
            expect(mockAlsStore.allApps[appName]).toBeUndefined();
            expect(fs.existsSync(appWebPath)).toBe(false);
            // Verify that shutdown functions were called before deletion
            expect(appLogger.shutdownApp).toHaveBeenCalledTimes(1);
            expect(db.shutdownApp).toHaveBeenCalledTimes(1);
        });
    });
});
