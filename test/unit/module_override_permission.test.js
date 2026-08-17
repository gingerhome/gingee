/**
 * module_override permission gates $g.overrideModule and gbox redirect.
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

  test('overrideModule succeeds with module_override permission', async () => {
    await runWithApp(['fs', 'module_override'], async () => {
      await gingee(async ($g) => {
        expect(() => $g.overrideModule('fs', 'library/fswrapper.js')).not.toThrow();
      });
      const store = als.getStore();
      expect(store.moduleOverrides.fs).toBe('library/fswrapper.js');
    });
  });
});
