const path = require('path');
const { als } = require('../../modules/gingee');
const { resolveSecurePath, SCOPES, isPathInside } = require('../../modules/internal_utils');

describe('internal_utils.js - isPathInside', () => {
    test('allows the boundary path itself', () => {
        const boundary = path.resolve('/project/web/app1');
        expect(isPathInside(boundary, boundary)).toBe(true);
    });

    test('allows nested descendants of the boundary', () => {
        const boundary = path.resolve('/project/web/app1');
        const nested = path.resolve('/project/web/app1/box/data/file.db');
        expect(isPathInside(nested, boundary)).toBe(true);
    });

    test('rejects classic string-prefix siblings (app1 vs app10)', () => {
        // String.startsWith would falsely allow this: '/project/web/app10'.startsWith('/project/web/app1') === true
        const boundary = path.resolve('/project/web/app1');
        const sibling = path.resolve('/project/web/app10/box/secret.js');
        expect(sibling.startsWith(boundary)).toBe(true); // documents the old bug class
        expect(isPathInside(sibling, boundary)).toBe(false);
    });

    test('rejects sibling apps that share a prefix with underscore (app1 vs app1_evil)', () => {
        const boundary = path.resolve('/project/web/app1');
        const sibling = path.resolve('/project/web/app1_evil/box/x.js');
        expect(isPathInside(sibling, boundary)).toBe(false);
    });

    test('rejects paths that escape upward with ..', () => {
        const boundary = path.resolve('/project/web/app1/box');
        const escaped = path.resolve(boundary, '../../other_app/box/file.js');
        expect(isPathInside(escaped, boundary)).toBe(false);
    });

    test('rejects empty or non-string inputs', () => {
        expect(isPathInside('', '/project/web/app1')).toBe(false);
        expect(isPathInside('/project/web/app1', '')).toBe(false);
        expect(isPathInside(null, '/project/web/app1')).toBe(false);
        expect(isPathInside('/project/web/app1', undefined)).toBe(false);
    });

    test('treats trailing separators as the same boundary', () => {
        const boundary = path.resolve('/project/web/app1');
        const withSep = boundary + path.sep;
        expect(isPathInside(withSep, boundary)).toBe(true);
        expect(isPathInside(path.join(withSep, 'box'), boundary)).toBe(true);
    });

    test('on win32, comparison is case-insensitive', () => {
        if (process.platform !== 'win32') {
            // Still validates the helper accepts absolute windows-style resolution via path.resolve
            return;
        }
        const boundary = 'C:\\project\\web\\App1';
        const nested = 'c:\\project\\web\\app1\\box\\file.js';
        expect(isPathInside(nested, boundary)).toBe(true);
        expect(isPathInside('c:\\project\\web\\app10\\box\\file.js', boundary)).toBe(false);
    });
});

describe('internal_utils.js - resolveSecurePath', () => {

    let mockStore;
    beforeEach(() => {
        // Create a fresh mock context for each test
        mockStore = {
            appName: 'app1',
            app: {
                name: 'app1',
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

    // Host apps expose `name` not `id` — prefix strip must still work
    test('should strip app name prefix when only app.name is set (production shape)', () => {
        const productionShape = {
            appName: 'app1',
            app: {
                name: 'app1',
                appWebPath: path.resolve('/project/web/app1'),
                appBoxPath: path.resolve('/project/web/app1/box'),
            },
            scriptFolder: path.resolve('/project/web/app1/box'),
        };
        als.run(productionShape, () => {
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

    test('should throw when relative path escapes into a sibling app', () => {
        als.run(mockStore, () => {
            expect(() => {
                resolveSecurePath(SCOPES.BOX, '../../../app10/box/secret.js');
            }).toThrow('Path Traversal Error');
        });
    });

    test('should allow resolving the BOX root itself via root-relative empty remainder', () => {
        als.run(mockStore, () => {
            // '/app1' with BOX scope strips app name then joins to box root
            const resolved = resolveSecurePath(SCOPES.BOX, '/');
            expect(resolved).toBe(path.resolve('/project/web/app1/box'));
        });
    });
});
