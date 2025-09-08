const { requestHandler } = require('../../ginger'); // Import the newly exported handler
const platform = require('../../modules/platform');
//const { als } = require('../../modules/ginger');
const { Writable } = require('stream');

// Mock all deep dependencies
jest.mock('fs-extra');
jest.mock('../../modules/db');
jest.mock('../../modules/cache_service');
jest.mock('../../modules/logger', () => ({
    init: jest.fn(),
    createAppLogger: jest.fn(() => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() })),
    shutdownApp: jest.fn(),
}));
jest.mock('../../modules/gapp_start', () => ({
    loadPermissionsForApp: jest.fn(),
    runStartupScripts: jest.fn()
}));


describe('Maintenance Mode Integration Test', () => {

    let mockApps;
    let mockReq;
    let mockRes;
    let gatekeeper;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules();

        jest.spyOn(console, 'log').mockImplementation(() => {});
        jest.spyOn(console, 'error').mockImplementation(() => {});

        // Setup a fresh mock app for each test
        mockApps = {
            'my-app': {
                name: 'my-app',
                in_maintenance: false,
                config: { 'startup-scripts': [] }, // prevent startup scripts from being called
                logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
            }
        };

        // Setup mock request/response
        mockReq = new Writable(); // Using a stream helps simulate a real request object
        mockReq.url = '/my-app/some/path';
        mockReq.headers = {};
        mockRes = {
            writeHead: jest.fn(),
            end: jest.fn()
        };
    });

    it('should block requests with a 503 status when an app is in maintenance mode', async () => {
        const mockAlsStore = {
            allApps: mockApps,
            logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
            projectRoot: '/fake/project' // needed for platform module context
        };

        jest.mock('../../modules/platform', () => ({
            ...jest.requireActual('../../modules/platform'),
            listBackups: jest.fn().mockReturnValue([]),
            setAppPermissions: jest.fn().mockResolvedValue(true),
            registerNewApp: jest.fn().mockResolvedValue(true),
            deleteApp: jest.fn().mockResolvedValue(true),
            reloadApp: jest.fn().mockImplementation(async (appName) => {
                mockApps[appName].in_maintenance = false; // Simulate reload finishing
                return true;
            })
        }));
        const platform = require('../../modules/platform');
        // Mock the gatekeeper promise
        let resolveGatekeeper;
        gatekeeper = new Promise(resolve => { resolveGatekeeper = resolve; });
        gatekeeper.release = resolveGatekeeper;

        platform.upgradeApp = jest.fn().mockImplementation(async (appName, buffer, options, context) => {
            mockApps[appName].in_maintenance = true; // Simulate upgrade starting
            await gatekeeper;
            platform.reloadApp(appName);
            return true;
        });

        const { als } = require('../../modules/ginger');

        // Start the upgrade process but don't await it. It will pause on our gatekeeper.
        const upgradePromise = als.run(mockAlsStore, () => {

            return platform.upgradeApp('my-app', Buffer.from(''), [], {});
        });

        // Give the event loop a tick to run the start of upgradeApp and set the flag
        await new Promise(process.nextTick);

        expect(mockApps['my-app'].in_maintenance).toBe(true);

        // While the upgrade is paused, simulate an incoming request to the main handler
        await requestHandler(mockReq, mockRes, mockApps, { logging: {} }, { warn: jest.fn() });

        // Assert that the request was blocked with 503
        expect(mockRes.writeHead).toHaveBeenCalledWith(503, { 'Content-Type': 'text/html' });
        expect(mockRes.end).toHaveBeenCalledWith(expect.stringContaining("maintenance"));

        // Now, allow the upgrade to finish
        gatekeeper.release();
        await upgradePromise;

        // The reloadApp mock should have been called, which resets the flag
        expect(mockApps['my-app'].in_maintenance).toBe(false);
        jest.restoreAllMocks();
    });
});
