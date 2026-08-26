const path = require("path");
const fs = require("fs");
const os = require("os");

const { als } = require("../../modules/gingee");
const {
  transpileCache,
  instanceCache,
  clearScriptCachesByPrefixes,
  clearInstanceCache,
} = require("../../modules/gbox");
const cacheService = require("../../modules/cache_service");
const cache = require("../../modules/cache");
const {
  resolvePrefixes,
  SCOPES,
} = require("../../modules/engine/app_cache_invalidate");

describe("cache.invalidateSysCache + script cache prefixes", () => {
  let tmp;
  let app;
  let logger;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gingee-inv-"));
    const web = path.join(tmp, "web", "demo");
    const box = path.join(web, "box");
    const area = path.join(box, "area", "A");
    fs.mkdirSync(area, { recursive: true });
    fs.mkdirSync(path.join(web, "area", "A"), { recursive: true });
    fs.writeFileSync(path.join(area, "x.js"), "module.exports = 1;");
    fs.mkdirSync(path.join(box, "other"), { recursive: true });
    fs.writeFileSync(path.join(box, "other", "y.js"), "module.exports = 2;");

    app = {
      name: "demo",
      appWebPath: web,
      appBoxPath: box,
      grantedPermissions: ["cache"],
    };
    logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    transpileCache.clear();
    clearInstanceCache();
    await cacheService.init({ provider: "memory", ttl: 60 }, logger);
  });

  afterEach(() => {
    transpileCache.clear();
    clearInstanceCache();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  test("clearScriptCachesByPrefixes drops matching transpile and instance keys", () => {
    const a = path.join(app.appBoxPath, "area", "A", "x.js");
    const b = path.join(app.appBoxPath, "other", "y.js");
    transpileCache.set(a, "code-a");
    transpileCache.set(b, "code-b");
    instanceCache.set(`demo\0${a}`, { exports: {} });
    instanceCache.set(`demo\0${b}`, { exports: {} });

    const counts = clearScriptCachesByPrefixes("demo", [
      path.join(app.appBoxPath, "area", "A"),
    ]);
    expect(counts.transpile).toBe(1);
    expect(counts.instance).toBe(1);
    expect(transpileCache.has(a)).toBe(false);
    expect(transpileCache.has(b)).toBe(true);
    expect(instanceCache.has(`demo\0${b}`)).toBe(true);
  });

  test("empty invalidateSysCache is a no-op", async () => {
    await als.run(
      {
        app,
        appName: "demo",
        logger,
        scriptFolder: path.join(app.appBoxPath, "area", "A"),
        fsScriptFolder: path.join(app.appBoxPath, "area", "A"),
      },
      async () => {
        const res = await cache.invalidateSysCache({});
        expect(res).toEqual({
          static: 0,
          scripts: { transpile: 0, instance: 0 },
        });
      },
    );
  });

  test("leading / scripts prefix resolves under box; cannot escape to sibling", async () => {
    const a = path.join(app.appBoxPath, "area", "A", "x.js");
    const b = path.join(app.appBoxPath, "other", "y.js");
    transpileCache.set(a, "a");
    transpileCache.set(b, "b");

    await als.run(
      {
        app,
        appName: "demo",
        logger,
        scriptFolder: path.join(app.appBoxPath, "area", "A"),
        fsScriptFolder: path.join(app.appBoxPath, "area", "A"),
      },
      async () => {
        const res = await cache.invalidateSysCache({
          scripts: ["/area/A"],
        });
        expect(res.scripts.transpile).toBe(1);
        expect(transpileCache.has(a)).toBe(false);
        expect(transpileCache.has(b)).toBe(true);
      },
    );
  });

  test("relative scripts prefix is jailed to calling script folder", async () => {
    const nested = path.join(app.appBoxPath, "area", "A", "gen", "z.js");
    fs.mkdirSync(path.dirname(nested), { recursive: true });
    fs.writeFileSync(nested, "module.exports = 3;");
    transpileCache.set(nested, "z");

    await als.run(
      {
        app,
        appName: "demo",
        logger,
        scriptFolder: path.join(app.appBoxPath, "area", "A"),
        fsScriptFolder: path.join(app.appBoxPath, "area", "A"),
      },
      async () => {
        await cache.invalidateSysCache({ scripts: ["gen"] });
        expect(transpileCache.has(nested)).toBe(false);
      },
    );
  });

  test("static prefix clears static: cache keys", async () => {
    const file = path.join(app.appWebPath, "area", "A", "hi.txt");
    fs.writeFileSync(file, "hi");
    await cacheService.set(`static:${file}`, { body: "hi" }, 60);

    await als.run(
      {
        app,
        appName: "demo",
        logger,
        scriptFolder: path.join(app.appBoxPath, "area", "A"),
        fsScriptFolder: path.join(app.appBoxPath, "area", "A"),
      },
      async () => {
        const res = await cache.invalidateSysCache({
          static: ["/area/A"],
        });
        expect(res.static).toBe(1);
        expect(await cacheService.get(`static:${file}`)).toBeNull();
      },
    );
  });

  test("resolvePrefixes rejects path outside app box", async () => {
    await expect(
      als.run(
        {
          app,
          appName: "demo",
          scriptFolder: app.appBoxPath,
          fsScriptFolder: app.appBoxPath,
        },
        async () => resolvePrefixes(SCOPES.BOX, ["/../etc"], app),
      ),
    ).rejects.toThrow(/forbidden|Path Traversal/i);
  });
});
