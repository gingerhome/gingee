const path = require("path");
const os = require("os");
const fs = require("fs");
const {
  serveStaticFile,
  _weakEtag,
  _validatorsFromStat,
  _isNotModified,
} = require("../../modules/engine/request/static");

function mockRes() {
  const chunks = [];
  const headers = {};
  const res = {
    statusCode: 200,
    headersSent: false,
    writeHead(code, h) {
      this.statusCode = code;
      Object.assign(headers, h || {});
      this.headersSent = true;
    },
    end(buf) {
      if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(String(buf)));
      this.headersSent = true;
    },
  };
  return { res, chunks, headers };
}

describe("static ETag / Last-Modified / 304", () => {
  let tmp;
  let filePath;
  let app;
  let cacheStore;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gingee-etag-"));
    filePath = path.join(tmp, "asset.js");
    fs.writeFileSync(filePath, "console.log(1)");
    app = {
      name: "etagapp",
      config: {
        cache: {
          client: { enabled: true, no_cache_regex: [] },
          server: { enabled: true, no_cache_regex: [] },
        },
      },
    };
    // attachCompiledCacheRegex shape
    const { attachCompiledCacheRegex } = require("../../modules/engine/request/cache_config");
    attachCompiledCacheRegex(app);
    cacheStore = new Map();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const cache = {
    async get(k) {
      return cacheStore.get(k) || null;
    },
    async set(k, v) {
      cacheStore.set(k, v);
    },
  };

  test("weakEtag from size+mtime", () => {
    expect(_weakEtag(10, 1000)).toBe('W/"10-1000"');
    const st = fs.statSync(filePath);
    const v = _validatorsFromStat(st);
    expect(v.etag).toMatch(/^W\/"/);
    expect(v.lastModified).toMatch(/GMT/);
  });

  test("200 includes ETag and Last-Modified when client cache on", async () => {
    const { res, headers, chunks } = mockRes();
    const req = { url: "/etagapp/asset.js", headers: {} };
    const outHeaders = {};
    await serveStaticFile({
      req,
      res,
      filePath,
      cacheConfig: app.config.cache,
      cache,
      canCompress: false,
      logger: { debug: jest.fn(), warn: jest.fn() },
      headers: outHeaders,
      app,
    });
    expect(res.statusCode).toBe(200);
    expect(headers["ETag"] || outHeaders["ETag"]).toMatch(/^W\/"/);
    expect(headers["Last-Modified"] || outHeaders["Last-Modified"]).toBeTruthy();
    expect(headers["Cache-Control"] || outHeaders["Cache-Control"]).toBe(
      "public, max-age=31536000",
    );
    expect(Buffer.concat(chunks).toString()).toContain("console.log");
  });

  test("If-None-Match yields 304", async () => {
    const st = fs.statSync(filePath);
    const v = _validatorsFromStat(st);
    const { res, chunks, headers } = mockRes();
    await serveStaticFile({
      req: {
        url: "/etagapp/asset.js",
        headers: { "if-none-match": v.etag },
      },
      res,
      filePath,
      cacheConfig: app.config.cache,
      cache,
      canCompress: false,
      logger: { debug: jest.fn() },
      headers: {},
      app,
    });
    expect(res.statusCode).toBe(304);
    expect(chunks.join("")).toBe("");
    expect(headers["ETag"]).toBe(v.etag);
  });

  test("no_cache_regex keeps no-store without long-lived validators", async () => {
    app.config.cache.client.no_cache_regex = ["/etagapp/asset"];
    const { attachCompiledCacheRegex } = require("../../modules/engine/request/cache_config");
    attachCompiledCacheRegex(app);
    const { res, headers } = mockRes();
    const outHeaders = {};
    await serveStaticFile({
      req: { url: "/etagapp/asset.js", headers: {} },
      res,
      filePath,
      cacheConfig: app.config.cache,
      cache,
      canCompress: false,
      logger: { debug: jest.fn() },
      headers: outHeaders,
      app,
    });
    expect(res.statusCode).toBe(200);
    expect(headers["Cache-Control"] || outHeaders["Cache-Control"]).toBe(
      "no-store",
    );
    expect(headers["ETag"] || outHeaders["ETag"]).toBeUndefined();
  });

  test("isNotModified helper", () => {
    const etag = 'W/"1-2"';
    const lm = new Date(1_700_000_000_000).toUTCString();
    expect(
      _isNotModified({ headers: { "if-none-match": etag } }, etag, lm),
    ).toBe(true);
    expect(
      _isNotModified(
        { headers: { "if-modified-since": lm } },
        etag,
        lm,
      ),
    ).toBe(true);
  });
});
