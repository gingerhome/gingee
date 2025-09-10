const path = require('path');
const fs = require('fs');
const { runInGBox } = require('../../modules/gbox');
const { als } = require('../../modules/gingee');

describe('gbox.js - Sandbox Security (Integration Tests)', () => {
    const testAppBoxPath = path.resolve(__dirname, '..', 'fixtures', 'apps', 'test_app', 'box');
    fs.mkdirSync(testAppBoxPath, { recursive: true });

    afterAll(() => {
        fs.rmSync(path.resolve(__dirname, '..', 'fixtures'), { recursive: true, force: true });
    });

    // This config is passed to the sandbox
    const mockGBoxConfig = {
        appName: 'test_app',
        app: {
            name: 'test_app',
            config: {},
            grantedPermissions: ['fs', 'db']
        },
        appBoxPath: testAppBoxPath,
        globalModulesPath: path.resolve(__dirname, '..', '..', 'modules'),
        allowedBuiltinModules: [],
        privilegedApps: ['glide'],
        useCache: false,
        logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
    };

    // This is the mock context that getContext() will return
    let mockAlsStore;
    beforeEach(() => {
        mockAlsStore = {
            appName: 'test_app',
            app: {
                name: 'test_app',
                config: {},
                grantedPermissions: ['fs', 'db']
            },
            // Provide a mock response object with the methods our code will call
            res: {
                writeHead: jest.fn(),
                end: jest.fn(),
                setHeader: jest.fn()
            },
            // Also provide a minimal req object
            req: {
                headers: {},
                connection: {}
            }
        };
    });


    test('should NOT allow a non-privileged app to require("platform")', () => {
        const scriptPath = path.join(testAppBoxPath, 'bad_require.js');
        // A minimal script that just does the require
        fs.writeFileSync(scriptPath, `module.exports = async function() { require('platform'); };`);

        // Wrap in als.run to provide the mock context
        als.run(mockAlsStore, () => {
            expect(() => {
                // The error is thrown during the 'require' phase, which happens
                // inside runInGBox itself, so we don't need to execute the script.
                // Correction: The error is in gRequire, which IS called during execution.
                // This is getting complex. Let's simplify the script itself.

                // Let's go back to the simple script from before, which doesn't use gingee()
                fs.writeFileSync(scriptPath, `const platform = require('platform');`);

                runInGBox(scriptPath, mockGBoxConfig);

            }).toThrow("has not been granted permission to access the 'platform' module");
        });
    });

    test('should ALLOW a privileged app to require("platform")', () => {
        const scriptPath = path.join(testAppBoxPath, 'good_require.js');
        fs.writeFileSync(scriptPath, `const platform = require('platform');`);

        // Update the mock store and config for this specific test
        const privilegedAlsStore = { ...mockAlsStore, appName: 'glide', app: { id: 'glide', config: {}, grantedPermissions: ['platform'] } };
        const privilegedConfig = { ...mockGBoxConfig, appName: 'glide', app: { id: 'glide', config: {}, grantedPermissions: ['platform'] } };

        als.run(privilegedAlsStore, () => {
            // This should not throw any error
            expect(() => {
                runInGBox(scriptPath, privilegedConfig);
            }).not.toThrow();
        });
    });

    test('should throw an error for a protected module that is NOT granted', () => {
        const scriptPath = path.join(testAppBoxPath, 'bad_require.js');
        fs.writeFileSync(scriptPath, `require('httpclient');`);

        als.run(mockAlsStore, () => {
            expect(() => {
                runInGBox(scriptPath, mockGBoxConfig);
            }).toThrow("has not been granted permission to access the 'httpclient' module");
        });
    });

    test('should ALLOW access to a protected module that IS granted', () => {
        const scriptPath = path.join(testAppBoxPath, 'good_require.js');
        fs.writeFileSync(scriptPath, `require('fs');`);

        als.run(mockAlsStore, () => {
            expect(() => {
                runInGBox(scriptPath, mockGBoxConfig);
            }).not.toThrow();
        });
    });

    test('should DENY access to a privileged module even if listed in grants', () => {
        // Even if an app somehow had 'platform' in its grants, the gbox's own check should still prevent it.
        const grantedPrivilegedStore = { ...mockAlsStore, app: { ...mockAlsStore.app, grantedPermissions: ['platform'] } };
        const grantedPrivilegedMockConfig = { ...mockGBoxConfig, app: { ...mockGBoxConfig.app, grantedPermissions: ['platform'] } };
        const scriptPath = path.join(testAppBoxPath, 'priv_require.js');
        fs.writeFileSync(scriptPath, `require('platform');`);

        als.run(grantedPrivilegedStore, () => {
            expect(() => {
                runInGBox(scriptPath, grantedPrivilegedMockConfig);
            }).toThrow("does not have permission to access the 'platform' module");
        });
    });

});
