/**
 * Static server cache stores pre-gzipped payloads; no_cache_regex skips cache.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const zlib = require('zlib');
const { serveStaticFile } = require('../../modules/engine/request/static');
const { attachCompiledCacheRegex } = require('../../modules/engine/request/cache_config');

describe('static pre-gzip cache', () => {
  let tmpDir;
  let filePath;
  let mem;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-static-'));
    filePath = path.join(tmpDir, 'big.js');
    // Compressible payload
    fs.writeFileSync(filePath, `${'console.log(1);\n'.repeat(200)}`);
    mem = new Map();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function mockCache() {
    return {
      async get(key) {
        return mem.has(key) ? mem.get(key) : null;
      },
      async set(key, value) {
        mem.set(key, value);
      },
    };
  }

  function mockRes() {
    const out = {
      statusCode: 0,
      headers: {},
      body: null,
      writeHead(code, headers) {
        out.statusCode = code;
        out.headers = { ...headers };
      },
      end(buf) {
        out.body = buf;
      },
    };
    return out;
  }

  test('cache set stores content + gzipContent; hit serves pre-gzip without re-encoding work', async () => {
    const app = {
      config: {
        cache: {
          client: { enabled: false, no_cache_regex: [] },
          server: { enabled: true, no_cache_regex: [] },
        },
      },
    };
    attachCompiledCacheRegex(app);
    const cache = mockCache();
    const logger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn() };

    const res1 = mockRes();
    await serveStaticFile({
      req: { url: '/demo/big.js', headers: { 'accept-encoding': 'gzip' } },
      res: res1,
      filePath,
      cacheConfig: app.config.cache,
      cache,
      canCompress: true,
      logger,
      headers: {},
      app,
    });

    expect(res1.statusCode).toBe(200);
    expect(res1.headers['Content-Encoding']).toBe('gzip');
    const key = `static:${filePath}`;
    expect(mem.has(key)).toBe(true);
    const entry = mem.get(key);
    expect(entry.content).toBeTruthy();
    expect(entry.gzipContent).toBeTruthy();

    const raw = Buffer.from(entry.content, 'base64');
    const gz = Buffer.from(entry.gzipContent, 'base64');
    expect(zlib.gunzipSync(gz).equals(raw)).toBe(true);
    expect(Buffer.compare(res1.body, gz)).toBe(0);

    // Hit path
    const res2 = mockRes();
    await serveStaticFile({
      req: { url: '/demo/big.js', headers: { 'accept-encoding': 'gzip' } },
      res: res2,
      filePath,
      cacheConfig: app.config.cache,
      cache,
      canCompress: true,
      logger,
      headers: {},
      app,
    });
    expect(res2.headers['Content-Encoding']).toBe('gzip');
    expect(Buffer.compare(res2.body, gz)).toBe(0);
  });

  test('server no_cache_regex skips cache read/write', async () => {
    const app = {
      config: {
        cache: {
          client: { enabled: false, no_cache_regex: [] },
          server: { enabled: true, no_cache_regex: ['\\/nocache\\/'] },
        },
      },
    };
    attachCompiledCacheRegex(app);
    const cache = mockCache();
    const logger = { info: jest.fn(), debug: jest.fn(), warn: jest.fn() };
    const res = mockRes();

    await serveStaticFile({
      req: { url: '/demo/nocache/big.js', headers: {} },
      res,
      filePath,
      cacheConfig: app.config.cache,
      cache,
      canCompress: false,
      logger,
      headers: {},
      app,
    });

    expect(res.statusCode).toBe(200);
    expect(mem.size).toBe(0);
  });
});
