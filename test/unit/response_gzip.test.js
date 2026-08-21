/**
 * $g.response.send gzip gated by content_encoding.size_threshold (default 1024).
 */
const zlib = require('zlib');
const { als } = require('../../modules/gingee');
const { initializeGContext } = require('../../modules/engine/request_context/build_g');

function makeStore(overrides = {}) {
  const chunks = [];
  const headers = {};
  const res = {
    statusCode: 200,
    setHeader(k, v) {
      headers[k] = v;
    },
    getHeader(k) {
      return headers[k];
    },
    end(buf) {
      chunks.push(buf);
    },
  };
  const store = {
    req: {
      method: 'GET',
      url: '/app/api',
      headers: { 'accept-encoding': 'gzip', host: 'localhost' },
      connection: {},
    },
    res,
    canCompress: true,
    app: {
      config: { name: 't', version: '1', description: '', env: {} },
      name: 't',
      grantedPermissions: [],
    },
    appName: 't',
    isPrivileged: false,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    },
    scriptPath: '/tmp/box/echo.js',
    scriptFolder: '/tmp/box',
    routeParams: null,
    globalConfig: {
      content_encoding: { enabled: true, size_threshold: 1024 },
    },
    ...overrides,
  };
  store.res = overrides.res || res;
  store._chunks = chunks;
  store._headers = headers;
  if (overrides.res) {
    // keep capture on the mock we create unless caller replaced res entirely
  }
  return store;
}

describe('response.send gzip (size_threshold)', () => {
  test('skips gzip for bodies under default 1KiB without compressing', () => {
    const store = makeStore();
    als.run(store, () => {
      initializeGContext(store);
      store.$g.response.send({ message: 'Hello world!' });
      expect(store._headers['Content-Encoding']).toBeUndefined();
      const raw = Buffer.isBuffer(store._chunks[0])
        ? store._chunks[0].toString('utf8')
        : String(store._chunks[0]);
      expect(JSON.parse(raw)).toEqual({ message: 'Hello world!' });
    });
  });

  test('gzips when body >= size_threshold', () => {
    const store = makeStore();
    const payload = {
      ok: true,
      pad: 'x'.repeat(1200),
    };
    als.run(store, () => {
      initializeGContext(store);
      store.$g.response.send(payload);
      expect(store._headers['Content-Encoding']).toBe('gzip');
      expect(store._headers['Vary']).toBe('Accept-Encoding');
      const raw = zlib.gunzipSync(store._chunks[0]).toString('utf8');
      expect(JSON.parse(raw)).toEqual(payload);
    });
  });

  test('content_encoding.size_threshold override (0 gzips small bodies)', () => {
    const store = makeStore({
      globalConfig: { content_encoding: { enabled: true, size_threshold: 0 } },
    });
    als.run(store, () => {
      initializeGContext(store);
      store.$g.response.send({ message: 'Hello world!' });
      expect(store._headers['Content-Encoding']).toBe('gzip');
      const raw = zlib.gunzipSync(store._chunks[0]).toString('utf8');
      expect(JSON.parse(raw)).toEqual({ message: 'Hello world!' });
    });
  });

  test('legacy min_bytes still honored if size_threshold unset', () => {
    const store = makeStore({
      globalConfig: { content_encoding: { enabled: true, min_bytes: 0 } },
    });
    als.run(store, () => {
      initializeGContext(store);
      store.$g.response.send({ message: 'Hello world!' });
      expect(store._headers['Content-Encoding']).toBe('gzip');
    });
  });

  test('skips gzip when canCompress is false', () => {
    const store = makeStore({
      canCompress: false,
      globalConfig: { content_encoding: { enabled: true, size_threshold: 0 } },
    });
    als.run(store, () => {
      initializeGContext(store);
      store.$g.response.send({ ok: true, pad: 'x'.repeat(1200) });
      expect(store._headers['Content-Encoding']).toBeUndefined();
    });
  });
});
