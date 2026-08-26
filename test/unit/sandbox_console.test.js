const path = require("path");
const os = require("os");
const fs = require("fs");
const { als } = require("../../modules/gingee");
const { runInGBox, clearInstanceCache, transpileCache } = require("../../modules/gbox");
const { createSandboxConsole } = require("../../modules/engine/sandbox_console");

describe("sandbox console → app logger", () => {
  let tmpRoot;
  let appBoxPath;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gingee-sconsole-"));
    appBoxPath = path.join(tmpRoot, "box");
    fs.mkdirSync(appBoxPath, { recursive: true });
    clearInstanceCache();
    transpileCache.clear();
  });

  afterEach(() => {
    clearInstanceCache();
    transpileCache.clear();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test("createSandboxConsole maps levels to logger methods", () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    const c = createSandboxConsole(logger);
    c.log("a", 1);
    c.info("i");
    c.warn("w");
    c.error("e", { x: 1 });
    c.debug("d");
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("a 1"));
    expect(logger.info).toHaveBeenCalledWith("i");
    expect(logger.warn).toHaveBeenCalledWith("w");
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("e"));
    expect(logger.debug).toHaveBeenCalledWith("d");
  });

  test("runInGBox console.error goes to gBoxConfig.logger not only host", async () => {
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
    fs.writeFileSync(
      path.join(appBoxPath, "logme.js"),
      [
        "module.exports = async function () {",
        "  await gingee(async ($g) => {",
        '    console.error("boom-from-sandbox");',
        '    $g.response.send({ ok: true });',
        "  });",
        "};",
        "",
      ].join("\n"),
    );

    const cfg = {
      appName: "sconsole",
      app: {
        name: "sconsole",
        config: { name: "sconsole", version: "1", description: "", env: {} },
        grantedPermissions: [],
        appBoxPath,
        appWebPath: path.join(tmpRoot, "web"),
        logger,
      },
      appBoxPath,
      globalModulesPath: path.resolve(__dirname, "..", "..", "modules"),
      localModulesPaths: [],
      allowedBuiltinModules: [],
      privilegedApps: [],
      useCache: false,
      logger,
    };

    const chunks = [];
    const res = {
      statusCode: 200,
      headersSent: false,
      setHeader() {},
      getHeader() {},
      writeHead(code) {
        this.statusCode = code;
        this.headersSent = true;
      },
      end(buf) {
        chunks.push(buf);
      },
    };

    await als.run(
      {
        req: { method: "GET", url: "/sconsole/x", headers: {}, connection: {} },
        res,
        app: cfg.app,
        appName: "sconsole",
        logger,
        scriptPath: path.join(appBoxPath, "logme.js"),
        scriptFolder: appBoxPath,
        globalConfig: { content_encoding: { enabled: false } },
        canCompress: false,
      },
      async () => {
        const handler = runInGBox(path.join(appBoxPath, "logme.js"), cfg);
        await handler();
      },
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("boom-from-sandbox"),
    );
  });
});
