const path = require('path');
const { als } = require('../../modules/ginger');
const { resolveSecurePath, SCOPES } = require('../../modules/internal_utils');

describe('internal_utils.js - resolveSecurePath', () => {

    let mockStore;
    beforeEach(() => {
        // Create a fresh mock context for each test
        mockStore = {
            appName: 'app1',
            app: {
                id: 'app1',
                appWebPath: path.resolve('/project/web/app1'),
                appBoxPath: path.resolve('/project/web/app1/box'),
            },
            scriptFolder: path.resolve('/project/web/app1/box/api'),
        };
    });

    // Test Case 1: Standard relative path
    test('should resolve a path relative to the current script folder', () => {
        als.run(mockStore, () => {
            const resolved = resolveSecurePath(SCOPES.BOX, './users/get.js');
            expect(resolved).toBe(path.resolve('/project/web/app1/box/api/users/get.js'));
        });
    });

    // Test Case 2: Mirrored path for WEB scope
    test('should resolve a relative path to the mirrored WEB location', () => {
        als.run(mockStore, () => {
            const resolved = resolveSecurePath(SCOPES.WEB, './assets/style.css');
            // Note: it starts from '.../box/api' and maps it to '.../web/app1/api' before resolving
            expect(resolved).toBe(path.resolve('/project/web/app1/api/assets/style.css'));
        });
    });

    // Test Case 3: Root-relative path (starts with '/')
    test('should resolve a path starting with `/` from the BOX root', () => {
        als.run(mockStore, () => {
            const resolved = resolveSecurePath(SCOPES.BOX, '/data/database.db');
            expect(resolved).toBe(path.resolve('/project/web/app1/box/data/database.db'));
        });
    });

    // Test Case 4: Root-relative path with appName prefix
    test('should resolve a path with an appName prefix from the WEB root', () => {
        als.run(mockStore, () => {
            const resolved = resolveSecurePath(SCOPES.WEB, '/app1/images/logo.png');
            expect(resolved).toBe(path.resolve('/project/web/app1/images/logo.png'));
        });
    });

    // Test Case 5: Path Traversal Security
    test('should throw a Path Traversal Error for paths escaping the boundary', () => {
        als.run(mockStore, () => {
            expect(() => {
                resolveSecurePath(SCOPES.BOX, '../../../../etc/hosts');
            }).toThrow('Path Traversal Error');
        });
    });
    
    /*
    test('should throw a Path Traversal Error for root-relative paths escaping the boundary', () => {
        als.run(mockStore, () => {
            // This path resolves inside the app web path, but the scope is BOX, so it's forbidden.
            expect(() => {
                resolveSecurePath(SCOPES.BOX, '/images/logo.png');
            }).toThrow('Path Traversal Error');
        });
    });
    */
});
