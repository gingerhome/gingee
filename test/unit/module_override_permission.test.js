/**
 * module_override: permission gate, non-overridable names, expanded specifier scope.
 */
const path = require('path');
const { als, gingee } = require('../../modules/gingee');

describe('module_override permission', () => {
  function runWithApp(grantedPermissions, fn) {
    const store = {
      req: { url: '/appsandboxtest/sandboxed/run', method: 'GET', headers: {}, connection: {} },
      res: {
        writeHead: jest.fn(),
        end: jest.fn(),
        setHeader: jest.fn(),
        headersSent: false
      },
      appName: 'appsandboxtest',
      app: {
        name: 'appsandboxtest',
        config: {
          name: 'App Sandbox Test',
          version: '1.0.0',
          description: 'test',
          env: {}
        },
        grantedPermissions,
        appBoxPath: path.resolve('/project/web/appsandboxtest/box'),
        appWebPath: path.resolve('/project/web/appsandboxtest')
      },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      scriptPath: path.resolve('/project/web/appsandboxtest/box/sandboxed/run.js'),
      scriptFolder: path.resolve('/project/web/appsandboxtest/box/sandboxed'),
      maxBodySize: '1mb'
    };
    return als.run(store, fn);
  }

  test('overrideModule throws without module_override permission', async () => {
    await runWithApp(['fs'], async () => {
      await gingee(async ($g) => {
        expect(() => $g.overrideModule('fs', 'library/fswrapper.js')).toThrow(
          /module_override/
        );
        expect($g.boxRelativeScript).toBe('sandboxed/run.js');
      });
    });
  });

  /**
   * Non-HTTP ALS store so gingee() runs the handler synchronously (HTTP path
   * swallows handler errors into a 500 response).
   */
  function runNonHttp(grantedPermissions, fn) {
    const store = {
      appName: 'appsandboxtest',
      app: {
        name: 'appsandboxtest',
        config: {
          name: 'App Sandbox Test',
          version: '1.0.0',
          description: 'test',
          env: {}
        },
        grantedPermissions,
        appBoxPath: path.resolve('/project/web/appsandboxtest/box'),
        appWebPath: path.resolve('/project/web/appsandboxtest')
      },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      scriptPath: path.resolve('/project/web/appsandboxtest/box/sandboxed/run.js'),
      scriptFolder: path.resolve('/project/web/appsandboxtest/box/sandboxed')
    };
    return als.run(store, fn);
  }

  test('overrideModule succeeds with module_override alone (no fs grant required to install)', async () => {
    await runNonHttp(['module_override'], async () => {
      await gingee(async ($g) => {
        // Bare 'fs' is the Gingee sandbox module — must be overridable (not node:fs).
        $g.overrideModule('fs', 'library/fswrapper.js');
        $g.overrideModule('crypto', 'library/crypto_wrap.js');
        $g.overrideModule('sandboxed/helper', 'library/helper_wrap.js');
        $g.overrideModule('shared/bare_util', 'library/bare_util_wrap.js');
        const store = als.getStore();
        expect(store.moduleOverrides.fs).toBe('library/fswrapper.js');
        expect(store.moduleOverrides.crypto).toBe('library/crypto_wrap.js');
        expect(store.moduleOverrides['sandboxed/helper']).toBe(
          'library/helper_wrap.js'
        );
        expect(store.moduleOverrides['shared/bare_util']).toBe(
          'library/bare_util_wrap.js'
        );
      });
    });
  });

  test('overrideModule rejects restricted and forbidden names', async () => {
    await runNonHttp(['module_override'], async () => {
      await gingee(async ($g) => {
        expect(() => $g.overrideModule('platform', 'library/x.js')).toThrow(/cannot be overridden/);
        expect(() => $g.overrideModule('gingee', 'library/x.js')).toThrow(/cannot be overridden/);
        expect(() => $g.overrideModule('child_process', 'library/x.js')).toThrow(
          /cannot be overridden/
        );
        expect(() => $g.overrideModule('node:fs', 'library/x.js')).toThrow(
          /cannot be overridden/
        );
        expect(() => $g.overrideModule('engine/boot', 'library/x.js')).toThrow(
          /cannot be overridden/
        );
      });
    });
  });
});
