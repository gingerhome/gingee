const { als } = require("../../modules/gingee");
const processGuards = require("../../modules/engine/process_guards");

describe("process_guards", () => {
  let mockLogger;
  let exitSpy;

  beforeEach(() => {
    processGuards._resetForTests();
    mockLogger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() };
    exitSpy = jest.spyOn(process, "exit").mockImplementation(() => {});
  });

  afterEach(() => {
    processGuards._resetForTests();
    exitSpy.mockRestore();
  });

  describe("unhandledRejection", () => {
    test("registerProcessGuards is idempotent for unhandledRejection", () => {
      const before = process.listenerCount("unhandledRejection");
      processGuards.registerProcessGuards(mockLogger);
      processGuards.registerProcessGuards(mockLogger);
      processGuards.registerProcessGuards(mockLogger);
      const after = process.listenerCount("unhandledRejection");
      expect(after - before).toBe(1);
      expect(processGuards._isRegistered()).toBe(true);
    });

    test("handler logs Error reason with stack and does not process.exit", () => {
      processGuards.registerProcessGuards(mockLogger);
      const err = new ReferenceError("boom-detached");
      processGuards._onUnhandledRejection(err, Promise.resolve());

      expect(mockLogger.error).toHaveBeenCalledTimes(1);
      const [msg, meta] = mockLogger.error.mock.calls[0];
      expect(msg).toContain("[unhandledRejection]");
      expect(msg).toContain("boom-detached");
      expect(meta).toEqual(
        expect.objectContaining({
          stack: expect.stringContaining("boom-detached"),
          hasPromise: true,
        }),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test("handler logs non-Error reasons as String(reason)", () => {
      processGuards.registerProcessGuards(mockLogger);
      processGuards._onUnhandledRejection("plain-fail");

      expect(mockLogger.error).toHaveBeenCalledWith(
        "[unhandledRejection] plain-fail",
        expect.objectContaining({ hasPromise: false }),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });

    test("handler includes ALS appName when store is set", async () => {
      processGuards.registerProcessGuards(mockLogger);
      await als.run({ appName: "demoapp" }, async () => {
        processGuards._onUnhandledRejection(new Error("in-request"));
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        "[unhandledRejection] in-request",
        expect.objectContaining({ app: "demoapp" }),
      );
    });

    test("real unhandledRejection emit is logged and process stays up", async () => {
      processGuards.registerProcessGuards(mockLogger);
      const err = new Error("emit-rejection");
      process.emit("unhandledRejection", err, Promise.resolve());
      await new Promise((r) => setImmediate(r));

      expect(mockLogger.error).toHaveBeenCalledWith(
        "[unhandledRejection] emit-rejection",
        expect.objectContaining({
          stack: expect.any(String),
          hasPromise: true,
        }),
      );
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe("uncaughtException", () => {
    test("registerProcessGuards is idempotent for uncaughtException", () => {
      const before = process.listenerCount("uncaughtException");
      processGuards.registerProcessGuards(mockLogger);
      processGuards.registerProcessGuards(mockLogger);
      const after = process.listenerCount("uncaughtException");
      expect(after - before).toBe(1);
      expect(processGuards._isUncaughtRegistered()).toBe(true);
    });

    test("logs, runs onFatalShutdown, then process.exit(1)", () => {
      const onFatalShutdown = jest.fn();
      processGuards.registerProcessGuards(mockLogger, { onFatalShutdown });

      const err = new Error("sync-boom");
      processGuards._onUncaughtException(err);

      expect(mockLogger.error).toHaveBeenCalledWith(
        "[uncaughtException] sync-boom",
        expect.objectContaining({
          stack: expect.stringContaining("sync-boom"),
          note: expect.stringMatching(/corrupt/i),
        }),
      );
      expect(onFatalShutdown).toHaveBeenCalledWith(err);
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test("includes ALS appName on uncaughtException when store is set", async () => {
      processGuards.registerProcessGuards(mockLogger, {
        onFatalShutdown: () => {},
      });
      await als.run({ appName: "fatalapp" }, async () => {
        processGuards._onUncaughtException(new Error("als-fatal"));
      });

      expect(mockLogger.error).toHaveBeenCalledWith(
        "[uncaughtException] als-fatal",
        expect.objectContaining({ app: "fatalapp" }),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test("still exits if onFatalShutdown throws", () => {
      processGuards.registerProcessGuards(mockLogger, {
        onFatalShutdown: () => {
          throw new Error("shutdown-failed");
        },
      });

      processGuards._onUncaughtException(new Error("primary"));

      expect(mockLogger.error).toHaveBeenCalledWith(
        "[uncaughtException] primary",
        expect.any(Object),
      );
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("graceful shutdown failed"),
        expect.any(Object),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    test("exits even without onFatalShutdown", () => {
      processGuards.registerProcessGuards(mockLogger);
      processGuards._onUncaughtException(new Error("no-shutdown-hook"));
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  test("formatReason extracts Error fields", () => {
    const e = new Error("x");
    expect(processGuards._formatReason(e)).toEqual({
      message: "x",
      stack: e.stack,
    });
    expect(processGuards._formatReason(42)).toEqual({
      message: "42",
      stack: undefined,
    });
  });
});
