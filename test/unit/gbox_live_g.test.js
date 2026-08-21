/**
 * Bare sandbox `$g` is an ALS-backed live Proxy (request-local).
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { als } = require('../../modules/gingee');
const { runInGBox, clearInstanceCache, transpileCache } = require('../../modules/gbox');

describe('gbox live $g', () => {
  let tmpRoot;
  let appBoxPath;
  let logger;

  function makeConfig(overrides = {}) {
    return {
      appName: 'liveg',
      app: {
        name: 'liveg',
        config: { name: 'liveg', version: '1', description: '', env: {} },
        grantedPermissions: [],
        appBoxPath,
        appWebPath: path.join(tmpRoot, 'web'),
      },
      appBoxPath,
      globalModulesPath: path.resolve(__dirname, '..', '..', 'modules'),
      localModulesPaths: [],
      allowedBuiltinModules: [],
      privilegedApps: [],
      useCache: true,
      logger,
      ...overrides,
    };
  }

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-liveg-'));
    appBoxPath = path.join(tmpRoot, 'box');
    fs.mkdirSync(path.join(appBoxPath, 'lib'), { recursive: true });
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    clearInstanceCache();
    transpileCache.clear();
  });

  afterEach(() => {
    clearInstanceCache();
    transpileCache.clear();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function runAls(cfg, fn) {
    const chunks = [];
    const headers = {};
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader(k, v) {
        headers[k] = v;
      },
      getHeader(k) {
        return headers[k];
      },
      writeHead(code, h) {
        this.statusCode = code;
        Object.assign(headers, h || {});
        this.headersSent = true;
      },
      end(buf) {
        chunks.push(buf);
      },
    };
    const store = {
      req: {
        method: 'GET',
        url: '/liveg/hello',
        headers: { host: 'localhost' },
        connection: {},
      },
      res,
      app: cfg.app,
      appName: cfg.appName,
      isPrivileged: false,
      logger,
      scriptPath: path.join(appBoxPath, 'entry.js'),
      scriptFolder: appBoxPath,
      routeParams: null,
      globalConfig: { content_encoding: { enabled: false } },
      canCompress: false,
      _chunks: chunks,
      _headers: headers,
    };
    return als.run(store, () => fn(store));
  }

  test('required module uses bare $g without pass-through', async () => {
    fs.writeFileSync(
      path.join(appBoxPath, 'lib', 'greeter.js'),
      [
        'module.exports = {',
        '  sendHello() {',
        '    $g.response.send({ message: "Hello, World!", app: $g.app.name });',
        '  },',
        '};',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(appBoxPath, 'entry.js'),
      [
        'module.exports = async function () {',
        '  await gingee(async ($g) => {',
        '    const greeter = require("./lib/greeter.js");',
        '    greeter.sendHello();',
        '  });',
        '};',
        '',
      ].join('\n'),
    );

    const cfg = makeConfig();
    await runAls(cfg, async (store) => {
      const handler = runInGBox(path.join(appBoxPath, 'entry.js'), cfg);
      await handler();
      const raw = Buffer.isBuffer(store._chunks[0])
        ? store._chunks[0].toString('utf8')
        : String(store._chunks[0]);
      expect(JSON.parse(raw)).toEqual({
        message: 'Hello, World!',
        app: 'liveg',
      });
    });
  });

  test('stashed root const local_$g = $g still tracks the current request', async () => {
    fs.writeFileSync(
      path.join(appBoxPath, 'lib', 'stash.js'),
      [
        'let local_$g;',
        'module.exports = {',
        '  capture() { local_$g = $g; },',
        '  send(msg) { local_$g.response.send({ msg, app: local_$g.app.name }); },',
        '};',
        '',
      ].join('\n'),
    );
    fs.writeFileSync(
      path.join(appBoxPath, 'entry.js'),
      [
        'module.exports = async function () {',
        '  await gingee(async ($g) => {',
        '    const stash = require("./lib/stash.js");',
        '    stash.capture();',
        '    stash.send($g.app.name + "-ok");',
        '  });',
        '};',
        '',
      ].join('\n'),
    );

    const cfg = makeConfig({ useCache: true });
    // Request 1
    await runAls(cfg, async (store) => {
      const handler = runInGBox(path.join(appBoxPath, 'entry.js'), cfg);
      await handler();
      const raw = Buffer.isBuffer(store._chunks[0])
        ? store._chunks[0].toString('utf8')
        : String(store._chunks[0]);
      expect(JSON.parse(raw).msg).toBe('liveg-ok');
    });
    // Request 2 — same cached module; stashed Proxy must follow ALS
    cfg.app.config.name = 'liveg';
    await runAls(cfg, async (store) => {
      store.app.config.name = 'liveg';
      const handler = runInGBox(path.join(appBoxPath, 'entry.js'), cfg);
      await handler();
      const raw = Buffer.isBuffer(store._chunks[0])
        ? store._chunks[0].toString('utf8')
        : String(store._chunks[0]);
      expect(JSON.parse(raw)).toEqual({ msg: 'liveg-ok', app: 'liveg' });
    });
  });

  test('top-level $g property access during module load throws', () => {
    // Binding `const x = $g` only captures the live Proxy; using it requires ALS+$g init.
    fs.writeFileSync(
      path.join(appBoxPath, 'bad.js'),
      'const x = $g.app;\nmodule.exports = x;\n',
    );
    const cfg = makeConfig({ useCache: false });
    expect(() =>
      runAls(cfg, () => {
        runInGBox(path.join(appBoxPath, 'bad.js'), cfg);
      }),
    ).toThrow(/not initialized yet|only available/i);
  });
});
