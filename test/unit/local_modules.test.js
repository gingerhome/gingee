/**
 * box.local_modules path resolution + gbox require roots.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  resolveLocalModulesPaths,
  localModulesPathsFromConfig
} = require('../../modules/engine/paths');
const { runInGBox } = require('../../modules/gbox');
const { als } = require('../../modules/gingee');
const { loadConfig, buildDefaultConfig, mergeUserConfig } = require('../../modules/engine/config');

describe('resolveLocalModulesPaths', () => {
  const proj = path.resolve('/project/root');

  test('empty / missing → []', () => {
    expect(resolveLocalModulesPaths(undefined, proj)).toEqual([]);
    expect(resolveLocalModulesPaths([], proj)).toEqual([]);
    expect(resolveLocalModulesPaths('', proj)).toEqual([]);
  });

  test('string sugar becomes one root under project', () => {
    const roots = resolveLocalModulesPaths('./local_modules', proj);
    expect(roots).toEqual([path.resolve(proj, 'local_modules')]);
  });

  test('array order preserved; first hit path first; dedupes', () => {
    const roots = resolveLocalModulesPaths(
      ['./local_modules', './packages', './local_modules'],
      proj
    );
    expect(roots).toEqual([
      path.resolve(proj, 'local_modules'),
      path.resolve(proj, 'packages')
    ]);
  });

  test('rejects absolute paths', () => {
    expect(() =>
      resolveLocalModulesPaths(['/etc/passwd'], proj)
    ).toThrow(/absolute/i);
  });

  test('rejects project root itself and escape via ..', () => {
    expect(() => resolveLocalModulesPaths(['.'], proj)).toThrow(/inside the project root/i);
    expect(() => resolveLocalModulesPaths(['..'], proj)).toThrow(/inside the project root/i);
    expect(() =>
      resolveLocalModulesPaths(['../outside'], proj)
    ).toThrow(/inside the project root/i);
  });
});

describe('loadConfig resolves localModulesPaths', () => {
  test('default box.local_modules is empty array', () => {
    const d = buildDefaultConfig();
    expect(d.box.local_modules).toEqual([]);
  });

  test('loadConfig sets absolute localModulesPaths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-lm-cfg-'));
    try {
      const { config } = loadConfig({
        root,
        userConfig: mergeUserConfig(buildDefaultConfig(), {
          box: { local_modules: ['./local_modules'] }
        })
      });
      expect(config.box.localModulesPaths).toEqual([
        path.resolve(root, 'local_modules')
      ]);
      expect(localModulesPathsFromConfig(config, root)).toEqual(
        config.box.localModulesPaths
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('gbox local_modules require', () => {
  let tmpRoot;
  let appBoxPath;
  let localRoot;
  let localRoot2;
  let gBoxConfig;
  let alsStore;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-lm-'));
    appBoxPath = path.join(tmpRoot, 'web', 'demo', 'box');
    localRoot = path.join(tmpRoot, 'local_modules');
    localRoot2 = path.join(tmpRoot, 'packages');
    fs.mkdirSync(appBoxPath, { recursive: true });
    fs.mkdirSync(path.join(localRoot, 'billing'), { recursive: true });
    fs.mkdirSync(localRoot2, { recursive: true });

    fs.writeFileSync(
      path.join(localRoot, 'tax.js'),
      `module.exports = { whoami: 'tax', n: 1 };\n`
    );
    fs.writeFileSync(
      path.join(localRoot, 'billing', 'invoice.js'),
      `module.exports = { whoami: 'billing/invoice' };\n`
    );
    fs.writeFileSync(
      path.join(localRoot, 'pkg.js'),
      `const inv = require('./billing/invoice');\nmodule.exports = { inv: inv.whoami };\n`
    );
    fs.writeFileSync(
      path.join(localRoot2, 'tax.js'),
      `module.exports = { whoami: 'packages/tax' };\n`
    );
    // index.js must NOT be used for bare require('folderpkg')
    fs.mkdirSync(path.join(localRoot, 'folderpkg'), { recursive: true });
    fs.writeFileSync(
      path.join(localRoot, 'folderpkg', 'index.js'),
      `module.exports = { whoami: 'should-not-resolve' };\n`
    );

    gBoxConfig = {
      appName: 'demo',
      app: { name: 'demo', config: {}, grantedPermissions: [] },
      appBoxPath,
      globalModulesPath: path.resolve(__dirname, '..', '..', 'modules'),
      localModulesPaths: [localRoot, localRoot2],
      allowedBuiltinModules: [],
      privilegedApps: [],
      useCache: false,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
    };
    alsStore = {
      appName: 'demo',
      app: gBoxConfig.app,
      logger: gBoxConfig.logger,
      req: { headers: {}, connection: {} },
      res: { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() }
    };
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('bare require from app box hits first local_modules root', () => {
    const scriptPath = path.join(appBoxPath, 'run.js');
    fs.writeFileSync(
      scriptPath,
      `module.exports = require('tax');\n`
    );
    als.run(alsStore, () => {
      const mod = runInGBox(scriptPath, gBoxConfig);
      expect(mod.whoami).toBe('tax');
      expect(mod.n).toBe(1);
    });
  });

  test('nested path require("billing/invoice")', () => {
    const scriptPath = path.join(appBoxPath, 'run2.js');
    fs.writeFileSync(
      scriptPath,
      `module.exports = require('billing/invoice');\n`
    );
    als.run(alsStore, () => {
      const mod = runInGBox(scriptPath, gBoxConfig);
      expect(mod.whoami).toBe('billing/invoice');
    });
  });

  test('first root wins over second root for same bare name', () => {
    const scriptPath = path.join(appBoxPath, 'run3.js');
    fs.writeFileSync(scriptPath, `module.exports = require('tax');\n`);
    als.run(alsStore, () => {
      const mod = runInGBox(scriptPath, gBoxConfig);
      expect(mod.whoami).toBe('tax'); // local_modules, not packages
    });
  });

  test('does not resolve index.js for bare folder name', () => {
    const scriptPath = path.join(appBoxPath, 'run4.js');
    fs.writeFileSync(scriptPath, `module.exports = require('folderpkg');\n`);
    als.run(alsStore, () => {
      expect(() => runInGBox(scriptPath, gBoxConfig)).toThrow(
        /not allowed or could not be found/
      );
    });
  });

  test('platform modules win over local_modules shadow attempt', () => {
    // Plant a fake "uuid.js" in local_modules; real platform uuid should win.
    fs.writeFileSync(
      path.join(localRoot, 'uuid.js'),
      `module.exports = { whoami: 'fake-local-uuid' };\n`
    );
    const scriptPath = path.join(appBoxPath, 'run5.js');
    fs.writeFileSync(
      scriptPath,
      `const u = require('uuid'); module.exports = { hasV4: typeof u.v4 === 'function', whoami: u.whoami };\n`
    );
    als.run(alsStore, () => {
      const mod = runInGBox(scriptPath, gBoxConfig);
      expect(mod.hasV4).toBe(true);
      expect(mod.whoami).toBeUndefined();
    });
  });

  test('local module relative require stays inside local root', () => {
    const scriptPath = path.join(appBoxPath, 'run6.js');
    fs.writeFileSync(scriptPath, `module.exports = require('pkg');\n`);
    als.run(alsStore, () => {
      const mod = runInGBox(scriptPath, gBoxConfig);
      expect(mod.inv).toBe('billing/invoice');
    });
  });

  test('local module relative require cannot escape local root', () => {
    fs.writeFileSync(
      path.join(localRoot, 'escape.js'),
      `module.exports = require('../../secret');\n`
    );
    // secret outside local root (but still under tmp project)
    fs.writeFileSync(
      path.join(tmpRoot, 'secret.js'),
      `module.exports = { leak: true };\n`
    );
    const scriptPath = path.join(appBoxPath, 'run7.js');
    fs.writeFileSync(scriptPath, `module.exports = require('escape');\n`);
    als.run(alsStore, () => {
      expect(() => runInGBox(scriptPath, gBoxConfig)).toThrow(
        /Path traversal|forbidden/i
      );
    });
  });
});
