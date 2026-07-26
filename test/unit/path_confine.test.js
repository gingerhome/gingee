/**
 * Path confinement for static / script / routes / SPA resolution (P0 C1/C2/H1).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  resolveConfinedPath,
  confineScriptPath,
  hasUnsafePathSegments,
  relativeToSegments,
  isInsideAppBox,
  isInsideAppWeb
} = require('../../modules/engine/request/path_confine');
const { resolveScriptTarget } = require('../../modules/engine/request/resolve');
const { handleSpa } = require('../../modules/engine/request/spa');
const { match } = require('path-to-regexp');

describe('path_confine helpers', () => {
  const webRoot = path.resolve('/project/web/demo');
  const boxRoot = path.join(webRoot, 'box');

  test('resolveConfinedPath allows nested files under root', () => {
    const p = resolveConfinedPath(webRoot, ['css', 'app.css']);
    expect(p).toBe(path.resolve(webRoot, 'css', 'app.css'));
    expect(isInsideAppWeb(p, webRoot)).toBe(true);
  });

  test('resolveConfinedPath allows empty segments (root itself)', () => {
    expect(resolveConfinedPath(webRoot, [])).toBe(path.resolve(webRoot));
    expect(resolveConfinedPath(webRoot, null)).toBe(path.resolve(webRoot));
  });

  test('resolveConfinedPath rejects .. segments (classic traversal)', () => {
    expect(resolveConfinedPath(webRoot, ['..', 'other', 'secret.txt'])).toBeNull();
    expect(resolveConfinedPath(webRoot, ['css', '..', '..', 'settings', 'key.pem'])).toBeNull();
  });

  test('resolveConfinedPath rejects absolute / drive segments', () => {
    expect(relativeToSegments('/etc/passwd')).toBeNull();
    expect(relativeToSegments('C:\\Windows\\system32')).toBeNull();
    expect(resolveConfinedPath(webRoot, '/etc/passwd')).toBeNull();
  });

  test('resolveConfinedPath rejects relative string with ..', () => {
    expect(resolveConfinedPath(boxRoot, '../../other/box/evil.js')).toBeNull();
    expect(resolveConfinedPath(boxRoot, 'api/../../../gingee.js')).toBeNull();
  });

  test('hasUnsafePathSegments detects traversal', () => {
    expect(hasUnsafePathSegments(['a', 'b'])).toBe(false);
    expect(hasUnsafePathSegments(['..'])).toBe(true);
    expect(hasUnsafePathSegments(['foo..bar'])).toBe(true);
  });

  test('confineScriptPath appends .js under box', () => {
    const p = confineScriptPath(boxRoot, ['api', 'hello'], { appendJs: true });
    expect(p).toBe(path.resolve(boxRoot, 'api', 'hello.js'));
  });

  test('confineScriptPath rejects escape with appendJs', () => {
    expect(
      confineScriptPath(boxRoot, ['..', '..', 'secret'], { appendJs: true })
    ).toBeNull();
  });

  test('confineScriptPath for routes.json relative scripts', () => {
    expect(confineScriptPath(boxRoot, 'api/users.js')).toBe(
      path.resolve(boxRoot, 'api', 'users.js')
    );
    expect(confineScriptPath(boxRoot, '../sibling/box/x.js')).toBeNull();
    expect(confineScriptPath(boxRoot, '/absolute/x.js')).toBeNull();
  });

  test('isInsideAppBox distinguishes box vs public web', () => {
    const inBox = path.resolve(boxRoot, 'hello.js');
    const publicFile = path.resolve(webRoot, 'index.html');
    expect(isInsideAppBox(inBox, boxRoot)).toBe(true);
    expect(isInsideAppBox(publicFile, boxRoot)).toBe(false);
    expect(isInsideAppWeb(publicFile, webRoot)).toBe(true);
  });
});

describe('resolveScriptTarget confinement', () => {
  let tmp;
  let appWeb;
  let appBox;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-path-confine-'));
    appWeb = path.join(tmp, 'web', 'demo');
    appBox = path.join(appWeb, 'box');
    fs.mkdirSync(path.join(appBox, 'api'), { recursive: true });
    fs.writeFileSync(path.join(appBox, 'hello.js'), 'module.exports = async () => {};');
    fs.writeFileSync(path.join(appBox, 'api', 'ok.js'), 'module.exports = async () => {};');
    // Sibling outside box (simulates escaped target)
    fs.mkdirSync(path.join(tmp, 'web', 'other', 'box'), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, 'web', 'other', 'box', 'pwn.js'),
      'module.exports = async () => {};'
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function makeApp(routes) {
    const compiledRoutes = (routes || []).map((r) => ({
      method: r.method || 'GET',
      script: r.script,
      scriptPath: confineScriptPath(appBox, r.script),
      matcher: match(r.path, { decode: decodeURIComponent })
    }));
    return {
      name: 'demo',
      appWebPath: appWeb,
      appBoxPath: appBox,
      compiledRoutes
    };
  }

  test('file-based routing resolves script inside box', () => {
    const app = makeApp([]);
    const result = resolveScriptTarget(
      { method: 'GET' },
      app,
      'demo',
      '/demo/hello',
      ['demo', 'hello']
    );
    expect(result.targetScriptPath).toBe(path.join(appBox, 'hello.js'));
  });

  test('file-based routing rejects .. traversal outside box', () => {
    const app = makeApp([]);
    const result = resolveScriptTarget(
      { method: 'GET' },
      app,
      'demo',
      '/demo/../../other/box/pwn',
      ['demo', '..', '..', 'other', 'box', 'pwn']
    );
    expect(result.targetScriptPath).toBeNull();
  });

  test('routes.json script inside box works when scriptPath precomputed', () => {
    const app = makeApp([{ path: '/api/ok', script: 'api/ok.js', method: 'GET' }]);
    expect(app.compiledRoutes[0].scriptPath).toBe(path.join(appBox, 'api', 'ok.js'));
    const result = resolveScriptTarget(
      { method: 'GET' },
      app,
      'demo',
      '/demo/api/ok',
      ['demo', 'api', 'ok']
    );
    // requestPath for matcher is path after app name
    // matcher is on route path '/api/ok' vs requestPath
    // resolveScriptTarget uses requestPath = urlWithoutQuery.substring(appName.length + 1)
    // '/demo/api/ok'.substring(5) = '/api/ok' — wait appName.length+1 for 'demo' is 5, substring(5) of '/demo/api/ok'
    // '/demo/api/ok'.substring(5) = '/api/ok' — good if path is that
    expect(result.targetScriptPath).toBe(path.join(appBox, 'api', 'ok.js'));
  });

  test('routes.json escaping script yields null scriptPath at compile helper', () => {
    expect(confineScriptPath(appBox, '../../../other/box/pwn.js')).toBeNull();
    const app = makeApp([{ path: '/pwn', script: '../../../other/box/pwn.js' }]);
    // scriptPath null → resolve treats as no script
    expect(app.compiledRoutes[0].scriptPath).toBeNull();
    const result = resolveScriptTarget(
      { method: 'GET' },
      app,
      'demo',
      '/demo/pwn',
      ['demo', 'pwn']
    );
    expect(result.targetScriptPath).toBeNull();
  });
});

describe('handleSpa path confinement', () => {
  let tmp;
  let appWeb;
  let appBox;
  let logger;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-spa-confine-'));
    appWeb = path.join(tmp, 'web', 'spaapp');
    appBox = path.join(appWeb, 'box');
    fs.mkdirSync(path.join(appWeb, 'dist', 'assets'), { recursive: true });
    fs.mkdirSync(appBox, { recursive: true });
    fs.writeFileSync(path.join(appWeb, 'dist', 'index.html'), '<html>ok</html>');
    fs.writeFileSync(path.join(appWeb, 'dist', 'assets', 'app.js'), 'console.log(1)');
    // Secret outside app web (sibling)
    fs.mkdirSync(path.join(tmp, 'web', 'secret'), { recursive: true });
    fs.writeFileSync(path.join(tmp, 'web', 'secret', 'key.pem'), 'SECRET');
    logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function spaApp(spaConfig) {
    return {
      name: 'spaapp',
      appWebPath: appWeb,
      appBoxPath: appBox,
      config: {
        type: 'SPA',
        spa: { enabled: true, ...(spaConfig || {}) }
      }
    };
  }

  function mockRes() {
    // Minimal writable so createReadStream().pipe(res) works in SPA fallback
    return {
      headersSent: false,
      statusCode: 0,
      body: null,
      writeHead(code) {
        this.statusCode = code;
        this.headersSent = true;
      },
      end(b) {
        if (b != null) this.body = Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
        this.headersSent = true;
      },
      write(chunk) {
        const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
        this.body = (this.body || '') + s;
        return true;
      },
      on() {
        return this;
      },
      once() {
        return this;
      },
      emit() {
        return true;
      },
      removeListener() {
        return this;
      }
    };
  }

  test('serves asset under confined build_path', () => {
    const res = mockRes();
    const result = handleSpa({
      req: { url: '/spaapp/assets/app.js' },
      res,
      app: spaApp({ build_path: 'dist' }),
      appName: 'spaapp',
      urlParts: ['spaapp', 'assets', 'app.js'],
      isDevelopment: false,
      logger
    });
    expect(result.handled).toBe(false);
    expect(result.filePath).toBe(path.join(appWeb, 'dist', 'assets', 'app.js'));
  });

  test('rejects escaping build_path with 500', () => {
    const res = mockRes();
    const result = handleSpa({
      req: { url: '/spaapp/' },
      res,
      app: spaApp({ build_path: '../../secret' }),
      appName: 'spaapp',
      urlParts: ['spaapp'],
      isDevelopment: false,
      logger
    });
    expect(result.handled).toBe(true);
    expect(res.statusCode).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });

  test('rejects asset traversal via urlParts ..', async () => {
    const res = mockRes();
    // .. must not escape buildPath; asset is rejected and safe fallback is used
    const result = handleSpa({
      req: { url: '/spaapp/../secret/key.pem' },
      res,
      app: spaApp({ build_path: 'dist', fallback_path: 'index.html' }),
      appName: 'spaapp',
      urlParts: ['spaapp', '..', 'secret', 'key.pem'],
      isDevelopment: false,
      logger
    });
    expect(result.filePath).toBeUndefined();
    expect(result.handled).toBe(true);
    expect(res.statusCode).toBe(200);
    // Allow stream to flush into mock writable
    await new Promise((r) => setTimeout(r, 30));
    expect(String(res.body || '')).toContain('ok');
    expect(String(res.body || '')).not.toContain('SECRET');
  });

  test('fallback_path escaping is not served', () => {
    const res = mockRes();
    // Valid build, but fallback points outside
    const result = handleSpa({
      req: { url: '/spaapp/missing' },
      res,
      app: spaApp({
        build_path: 'dist',
        fallback_path: '../../../secret/key.pem'
      }),
      appName: 'spaapp',
      urlParts: ['spaapp', 'missing'],
      isDevelopment: false,
      logger
    });
    expect(result.handled).toBe(false);
    expect(result.filePath).toBeUndefined();
  });
});

describe('request_handler static confinement (integration-style)', () => {
  let tmp;
  let appWeb;
  let appBox;
  let createRequestHandler;
  let webPath;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-rh-confine-'));
    webPath = path.join(tmp, 'web');
    appWeb = path.join(webPath, 'demo');
    appBox = path.join(appWeb, 'box');
    fs.mkdirSync(appBox, { recursive: true });
    fs.writeFileSync(path.join(appWeb, 'public.txt'), 'public-ok');
    fs.writeFileSync(path.join(appBox, 'secret.js'), 'module.exports=async()=>{};');
    // Host-adjacent secret outside web root
    fs.writeFileSync(path.join(tmp, 'host-secret.pem'), 'HOST-SECRET');
    createRequestHandler = require('../../modules/engine/request_handler').createRequestHandler;
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    jest.resetModules();
  });

  function makeRes() {
    const res = {
      headersSent: false,
      statusCode: 0,
      body: null,
      headers: {},
      writeHead(code, h) {
        this.statusCode = code;
        if (h) this.headers = { ...this.headers, ...h };
        this.headersSent = true;
      },
      end(b) {
        this.body = b == null ? '' : Buffer.isBuffer(b) ? b.toString('utf8') : String(b);
        this.headersSent = true;
      },
      setHeader() {},
      on() {
        return this;
      },
      once() {
        return this;
      }
    };
    return res;
  }

  async function waitForResponse(res, timeoutMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (res.headersSent && res.body != null) return;
      await new Promise((r) => setImmediate(r));
    }
  }

  function baseApp() {
    return {
      name: 'demo',
      appWebPath: appWeb,
      appBoxPath: appBox,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      config: {
        type: 'MPA',
        mode: 'production',
        cache: {
          client: { enabled: false, no_cache_regex: [] },
          server: { enabled: false, no_cache_regex: [] }
        }
      },
      in_maintenance: false
    };
  }

  test('serves public static file under app web', async () => {
    const handler = createRequestHandler({ webPath, engineRoot: tmp });
    const req = {
      url: '/demo/public.txt',
      method: 'GET',
      headers: {}
    };
    const res = makeRes();
    const apps = { demo: baseApp() };
    const config = {
      content_encoding: { enabled: false },
      privileged_apps: []
    };
    handler(req, res, apps, config, apps.demo.logger);
    await waitForResponse(res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('public-ok');
  });

  test('blocks path traversal to host secret via ..', async () => {
    const handler = createRequestHandler({ webPath, engineRoot: tmp });
    const req = {
      url: '/demo/../../host-secret.pem',
      method: 'GET',
      headers: {}
    };
    const res = makeRes();
    const apps = { demo: baseApp() };
    const config = {
      content_encoding: { enabled: false },
      privileged_apps: []
    };
    handler(req, res, apps, config, apps.demo.logger);
    await waitForResponse(res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toBe('ACCESS_DENIED');
    expect(String(res.body || '')).not.toContain('HOST-SECRET');
  });

  test('blocks static access to box files', async () => {
    const handler = createRequestHandler({ webPath, engineRoot: tmp });
    const req = {
      url: '/demo/box/secret.js',
      method: 'GET',
      headers: {}
    };
    const res = makeRes();
    const apps = { demo: baseApp() };
    const config = {
      content_encoding: { enabled: false },
      privileged_apps: []
    };
    handler(req, res, apps, config, apps.demo.logger);
    await waitForResponse(res);
    expect(res.statusCode).toBe(403);
    expect(res.body).toBe('ACCESS_DENIED');
  });
});
