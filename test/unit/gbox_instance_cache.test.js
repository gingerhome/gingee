/**
 * Sandboxed module instance cache (cache.server / useCache).
 * Prefers vm.runInContext call counts over absolute latency.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const vm = require('vm');
const { als } = require('../../modules/gingee');
const {
  runInGBox,
  clearInstanceCache,
  instanceCache,
  transpileCache,
} = require('../../modules/gbox');

describe('gbox instance cache', () => {
  let tmpRoot;
  let appBoxPath;
  let localRoot;
  let runInContextSpy;
  let logger;

  function makeConfig(overrides = {}) {
    return {
      appName: 'demo',
      app: { name: 'demo', config: {}, grantedPermissions: [] },
      appBoxPath,
      globalModulesPath: path.resolve(__dirname, '..', '..', 'modules'),
      localModulesPaths: [localRoot],
      allowedBuiltinModules: [],
      privilegedApps: [],
      useCache: true,
      logger,
      ...overrides,
    };
  }

  function alsStoreFor(cfg) {
    return {
      appName: cfg.appName,
      app: cfg.app,
      logger: cfg.logger,
      req: { headers: {}, connection: {} },
      res: { writeHead: jest.fn(), end: jest.fn(), setHeader: jest.fn() },
    };
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-inst-'));
    appBoxPath = path.join(tmpRoot, 'web', 'demo', 'box');
    localRoot = path.join(tmpRoot, 'local_modules');
    fs.mkdirSync(path.join(appBoxPath, 'lib'), { recursive: true });
    fs.mkdirSync(path.join(localRoot, 'mylib'), { recursive: true });

    fs.writeFileSync(
      path.join(localRoot, 'mylib', 'store.js'),
      [
        'let loadCount = 0;',
        'loadCount++;',
        'module.exports = {',
        '  ping() { return loadCount; },',
        '  bump() { loadCount++; return loadCount; },',
        '};',
        '',
      ].join('\n'),
    );

    fs.writeFileSync(
      path.join(appBoxPath, 'lib', 'util.js'),
      [
        'let loadCount = 0;',
        'loadCount++;',
        'module.exports = {',
        '  ping() { return loadCount; },',
        '};',
        '',
      ].join('\n'),
    );

    fs.writeFileSync(
      path.join(appBoxPath, 'echo.js'),
      [
        'module.exports = async function () {',
        '  const store = require("mylib/store");',
        '  const util = require("./lib/util.js");',
        '  return { loads: store.ping(), utilLoads: util.ping() };',
        '};',
        '',
      ].join('\n'),
    );

    fs.writeFileSync(
      path.join(appBoxPath, 'handler_counter.js'),
      [
        'let n = 0;',
        'module.exports = async function () {',
        '  n++;',
        '  return { n };',
        '};',
        '',
      ].join('\n'),
    );

    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    clearInstanceCache();
    transpileCache.clear();
    runInContextSpy = jest.spyOn(vm, 'runInContext');
  });

  afterEach(() => {
    runInContextSpy.mockRestore();
    clearInstanceCache();
    transpileCache.clear();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function vmCallsFor(basename) {
    return runInContextSpy.mock.calls.filter((call) => {
      const opts = call[2] || {};
      return opts.filename && String(opts.filename).replace(/\\/g, '/').endsWith(basename);
    }).length;
  }

  test('useCache: true reuses instances — loadCount stays 1; VM once per file', async () => {
    const cfg = makeConfig({ useCache: true });
    const scriptPath = path.join(appBoxPath, 'echo.js');

    await als.run(alsStoreFor(cfg), async () => {
      const results = [];
      for (let i = 0; i < 20; i++) {
        const handler = runInGBox(scriptPath, cfg);
        results.push(await handler());
      }
      expect(results.every((r) => r.loads === 1 && r.utilLoads === 1)).toBe(true);
      expect(vmCallsFor('/echo.js')).toBe(1);
      expect(vmCallsFor('/store.js')).toBe(1);
      expect(vmCallsFor('/util.js')).toBe(1);
    });
  });

  test('cached handler export is still invoked every time', async () => {
    const cfg = makeConfig({ useCache: true });
    const scriptPath = path.join(appBoxPath, 'handler_counter.js');

    await als.run(alsStoreFor(cfg), async () => {
      const seen = [];
      for (let i = 0; i < 10; i++) {
        const handler = runInGBox(scriptPath, cfg);
        seen.push((await handler()).n);
      }
      expect(seen).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      expect(vmCallsFor('/handler_counter.js')).toBe(1);
    });
  });

  test('useCache: false re-executes every time and picks up disk edits', async () => {
    const cfg = makeConfig({ useCache: false });
    const utilPath = path.join(appBoxPath, 'lib', 'util.js');
    const scriptPath = path.join(appBoxPath, 'lib_only.js');
    fs.writeFileSync(
      scriptPath,
      'module.exports = require("./lib/util.js");\n',
    );

    await als.run(alsStoreFor(cfg), async () => {
      const a = runInGBox(scriptPath, cfg);
      expect(a.ping()).toBe(1);
      const b = runInGBox(scriptPath, cfg);
      expect(b.ping()).toBe(1); // fresh module each time; loadCount resets in new scope
      expect(vmCallsFor('/util.js')).toBeGreaterThanOrEqual(2);

      fs.writeFileSync(
        utilPath,
        [
          'let loadCount = 0;',
          'loadCount++;',
          'module.exports = { ping() { return loadCount; }, mark: "edited" };',
          '',
        ].join('\n'),
      );
      const c = runInGBox(scriptPath, cfg);
      expect(c.mark).toBe('edited');
    });
  });

  test('circular require succeeds with cache on', () => {
    fs.writeFileSync(
      path.join(appBoxPath, 'circ_a.js'),
      [
        'exports.name = "a";',
        'const b = require("./circ_b.js");',
        'exports.bName = b.name;',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(appBoxPath, 'circ_b.js'),
      [
        'exports.name = "b";',
        'const a = require("./circ_a.js");',
        'exports.aName = a.name;',
        '',
      ].join('\n'),
    );
    const cfg = makeConfig({ useCache: true });
    const entry = path.join(appBoxPath, 'circ_entry.js');
    fs.writeFileSync(
      entry,
      'module.exports = { a: require("./circ_a.js"), b: require("./circ_b.js") };\n',
    );

    als.run(alsStoreFor(cfg), () => {
      const mod = runInGBox(entry, cfg);
      expect(mod.a.name).toBe('a');
      expect(mod.b.name).toBe('b');
      expect(mod.a.bName).toBe('b');
      expect(mod.b.aName).toBe('a');
    });
  });

  test('two apps sharing local_modules path get separate instances', () => {
    const boxA = path.join(tmpRoot, 'web', 'appA', 'box');
    const boxB = path.join(tmpRoot, 'web', 'appB', 'box');
    fs.mkdirSync(boxA, { recursive: true });
    fs.mkdirSync(boxB, { recursive: true });
    fs.writeFileSync(
      path.join(boxA, 'run.js'),
      'module.exports = require("mylib/store");\n',
    );
    fs.writeFileSync(
      path.join(boxB, 'run.js'),
      'module.exports = require("mylib/store");\n',
    );

    const cfgA = makeConfig({
      appName: 'appA',
      app: { name: 'appA', config: {}, grantedPermissions: [] },
      appBoxPath: boxA,
      useCache: true,
    });
    const cfgB = makeConfig({
      appName: 'appB',
      app: { name: 'appB', config: {}, grantedPermissions: [] },
      appBoxPath: boxB,
      useCache: true,
    });

    als.run(alsStoreFor(cfgA), () => {
      const storeA = runInGBox(path.join(boxA, 'run.js'), cfgA);
      expect(storeA.ping()).toBe(1);
      storeA.bump();
      expect(storeA.ping()).toBe(2);
    });

    als.run(alsStoreFor(cfgB), () => {
      const storeB = runInGBox(path.join(boxB, 'run.js'), cfgB);
      expect(storeB.ping()).toBe(1); // not 2 — separate instance
    });
  });

  test('clearInstanceCache(appName) forces re-exec on next run', async () => {
    const cfg = makeConfig({ useCache: true });
    const scriptPath = path.join(appBoxPath, 'echo.js');

    await als.run(alsStoreFor(cfg), async () => {
      const h1 = runInGBox(scriptPath, cfg);
      expect((await h1()).loads).toBe(1);
      expect(vmCallsFor('/store.js')).toBe(1);

      clearInstanceCache('demo');
      expect(
        [...instanceCache.keys()].every((k) => !k.startsWith('demo\0')),
      ).toBe(true);

      const h2 = runInGBox(scriptPath, cfg);
      expect((await h2()).loads).toBe(1); // new module scope
      expect(vmCallsFor('/store.js')).toBe(2);
    });
  });

  test('protected module still denied with cache on', () => {
    const cfg = makeConfig({
      useCache: true,
      app: { name: 'demo', config: {}, grantedPermissions: [] },
    });
    const scriptPath = path.join(appBoxPath, 'need_db.js');
    fs.writeFileSync(
      scriptPath,
      'module.exports = require("db");\n',
    );

    als.run(alsStoreFor(cfg), () => {
      expect(() => runInGBox(scriptPath, cfg)).toThrow(/permission|Security|db/i);
    });
  });

  test('failed load does not poison instance cache', () => {
    const cfg = makeConfig({ useCache: true });
    const badPath = path.join(appBoxPath, 'bad.js');
    fs.writeFileSync(badPath, 'throw new Error("boom-load");\n');

    als.run(alsStoreFor(cfg), () => {
      expect(() => runInGBox(badPath, cfg)).toThrow(/boom-load/);
      fs.writeFileSync(badPath, 'module.exports = { ok: true };\n');
      const mod = runInGBox(badPath, cfg);
      expect(mod.ok).toBe(true);
    });
  });

  test('hot-path transpile cache does not log at info', () => {
    const cfg = makeConfig({ useCache: true });
    const scriptPath = path.join(appBoxPath, 'echo.js');

    als.run(alsStoreFor(cfg), () => {
      runInGBox(scriptPath, cfg);
      runInGBox(scriptPath, cfg);
      const infoMsgs = logger.info.mock.calls.map((c) => String(c[0]));
      expect(infoMsgs.some((m) => /CACHE HIT/i.test(m))).toBe(false);
      expect(infoMsgs.some((m) => /CACHE SET/i.test(m))).toBe(false);
    });
  });
});
