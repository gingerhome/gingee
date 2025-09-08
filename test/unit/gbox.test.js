const path = require('path');
const fs = require('fs');
const { als } = require('../../modules/ginger');
const { runInGBox } = require('../../modules/gbox');

// Mock dependencies
// Mock the fs module at the top level
jest.mock('fs');
jest.mock('sucrase'); // We don't need to mock the implementation here

// Mocking platform, as it's a restricted global
jest.mock('platform', () => ({}), { virtual: true });
jest.mock('utils', () => ({}), { virtual: true });

const sucrase = require('sucrase');

describe('gbox.js - Sandbox Execution', () => {
    let mockGBoxConfig;
    let mockAlsStore;

    beforeEach(() => {
        // Reset mocks before each test
        jest.resetAllMocks();

        sucrase.transform.mockClear();

        const testAppBoxPath = path.resolve('/project/web/test_app/box');
        mockGBoxConfig = {
            appName: 'test_app',
            app: { id: 'test_app', config: {}, grantedPermissions: ["image"] },
            appBoxPath: testAppBoxPath,
            globalModulesPath: path.resolve('/project/modules'),
            allowedBuiltinModules: ['path'],
            privilegedApps: ['glide'],
            useCache: false,
            logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
        };
        mockAlsStore = {
            appName: 'test_app',
            app: { id: 'test_app', config: {}, grantedPermissions: ["image"] },
            res: { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() },
            req: { headers: {}, connection: {} }
        };
    });

    // --- Security Tests ---
    test('gRequire should throw an error for a non-privileged app requiring "platform" without permission', () => {
        als.run(mockAlsStore, () => {
            const scriptContent = `const platform = require('platform');`;
            fs.readFileSync.mockReturnValue(scriptContent);

            expect(() => {
                runInGBox('/project/web/test_app/box/script.js', mockGBoxConfig);
            }).toThrow("has not been granted permission to access the 'platform' module");
        });
    });

    test('gRequire should throw an error for a non-privileged app requiring "platform" even when granted permission', () => {
        als.run(mockAlsStore, () => {
            const scriptContent = `const platform = require('platform');`;
            fs.readFileSync.mockReturnValue(scriptContent);

            expect(() => {
                runInGBox('/project/web/test_app/box/script.js', { ...mockGBoxConfig, app: { ...mockGBoxConfig.app, grantedPermissions: ['platform'] } });
            }).toThrow("does not have permission to access the 'platform' module");
        });
    });

    test('gRequire should allow a privileged app to require("platform")', () => {
        const privilegedStore = { ...mockAlsStore, appName: 'glide', app: { id: 'glide', config: {}, grantedPermissions: ['platform'] } };
        const privilegedGBoxconfig = { ...mockGBoxConfig, appName: 'glide', app: { id: 'glide', config: {}, grantedPermissions: ['platform'] } };
        als.run(privilegedStore, () => {
            const scriptContent = `const platform = require('platform');`;
            fs.readFileSync.mockReturnValue(scriptContent);

            expect(() => {
                runInGBox('/project/web/glide/box/script.js', privilegedGBoxconfig);
            }).not.toThrow();
        });
    });

    test('gRequire should throw an error for a forbidden built-in module', () => {
        als.run(mockAlsStore, () => {
            const scriptContent = `require('os');`;
            const MOCK_SCRIPT_PATH = '/project/web/test_app/box/script.js';

            // --- The Fix ---
            // Set up the mock implementations INSIDE the test
            fs.readFileSync.mockReturnValue(scriptContent);
            fs.existsSync.mockImplementation((filePath) => {
                // If it's checking for the global 'os.js', say it doesn't exist
                if (path.basename(filePath) === 'os.js') {
                    return false;
                }
                
                return false;
            });
            // --- End Fix ---

            expect(() => {
                runInGBox(MOCK_SCRIPT_PATH, mockGBoxConfig);
            }).toThrow("Module 'os' is not allowed or could not be found.");
        });
    });

    test('gRequire should allow resolving a whitelisted built-in module', () => {
        als.run(mockAlsStore, () => {
            const scriptContent = `require('mime-types');`;
            const MOCK_SCRIPT_PATH = '/project/web/test_app/box/script.js';

            // Set up the mock implementations INSIDE the test
            fs.readFileSync.mockReturnValue(scriptContent);
            fs.existsSync.mockImplementation((filePath) => {
                // If it's checking for the global 'mime-types.js', say it doesn't exist
                if (path.basename(filePath) === 'mime-types.js') {
                    return false;
                }
                
                return false;
            });

            expect(() => {
                runInGBox(MOCK_SCRIPT_PATH, mockGBoxConfig);
            }).not.toThrow();
        });
    });

    test('gRequire should resolve to GingerJS module for global app modules like image (sandboxed)', () => {
        als.run(mockAlsStore, () => {
            const scriptContent = `const image = require('image');`;
            const mockScriptPath = '/project/web/test_app/box/script.js';
            fs.readFileSync.mockReturnValue(scriptContent);
            fs.existsSync.mockImplementation((filePath) => {
                return true;
            });

            const gBoxConfig = { ...mockGBoxConfig, globalModulesPath: path.resolve('./modules') };

            let result;
            expect(() => {
                result = runInGBox(mockScriptPath, gBoxConfig);
            }).not.toThrow();
        });
    });

    // --- Transpilation Tests ---
    test('should transpile a script containing ESM "import" syntax', () => {
        als.run(mockAlsStore, () => {
            const esmContent = `import utils from 'utils'; export default () => {};`;
            fs.readFileSync.mockReturnValue(esmContent);
            fs.existsSync.mockImplementation((filePath) => {
                if (path.basename(filePath) === 'utils.js') {
                    jest.mock(filePath, () => ({}), { virtual: true });
                    return true;
                }
                return false;
            });
            sucrase.transform.mockReturnValue({ code: 'const utils = require("utils"); module.exports = () => {};' });

            runInGBox('/project/web/test_app/box/script.js', mockGBoxConfig);

            // Verify that the transpiler was called
            expect(sucrase.transform).toHaveBeenCalledTimes(1);
            expect(sucrase.transform).toHaveBeenCalledWith(esmContent, { transforms: ['imports', 'jsx', 'typescript'] });
        });
    });

    test('should NOT transpile a script with only CommonJS "require" syntax', () => {
        als.run(mockAlsStore, () => {
            const cjsContent = `const utils = require('utils'); module.exports = () => {};`;
            fs.readFileSync.mockReturnValue(cjsContent);
            fs.existsSync.mockImplementation((filePath) => {
                jest.mock(filePath, () => ({}), { virtual: true });
                return true;
            });

            runInGBox('/project/web/test_app/box/script.js', mockGBoxConfig);

            // Verify that the transpiler was NOT called
            expect(sucrase.transform).not.toHaveBeenCalled();
        });
    });
});
