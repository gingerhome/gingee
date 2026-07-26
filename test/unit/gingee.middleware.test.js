const { EventEmitter } = require("events");
const { als, gingee } = require("../../modules/gingee");

describe("gingee.js - Middleware Logic", () => {
  let mockStore;
  let mockReq;
  let mockRes;
  let handler;

  beforeEach(() => {
    // Create a fresh mock context and request/response objects for each test
    class MockReadableStream extends EventEmitter {
      constructor() {
        super();
        this.url = "/test/path?query=1";
        this.headers = {};
        this.method = "GET";
        this.connection = {};
      }
    }

    mockReq = new MockReadableStream(); // Simulate the request stream

    mockRes = {
      writeHead: jest.fn(),
      end: jest.fn(),
      setHeader: jest.fn(),
    };

    mockStore = {
      req: mockReq,
      res: mockRes,
      maxBodySize: "10mb",
      appName: "test_app",
      app: {
        config: { name: "Test App", version: "1.0.0", env: {} },
      },
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      scriptPath: "/path/to/script.js",
    };

    // A mock handler function that we can inspect
    handler = jest.fn();
  });

  test("should create the $g object and call the handler for a GET request", async () => {
    await als.run(mockStore, async () => {
      await gingee(handler);
    });

    expect(handler).toHaveBeenCalledTimes(1);
    const $g = handler.mock.calls[0][0];

    // This assertion will now pass because the URL was parsed correctly.
    expect($g.request.query.query).toBe("1");

    // The other assertions can now run.
    expect($g.response.send).toBeInstanceOf(Function);
    expect($g.app.name).toBe("Test App");
  });

  test("should correctly parse a JSON POST body", async () => {
    mockReq.url = "/test/post";
    mockReq.method = "POST";
    mockReq.headers["content-type"] = "application/json";
    const data = '{"key":"value"}';
    mockReq.headers["content-length"] = `${data.length}`;
    mockStore.req = mockReq;

    await als.run(mockStore, async () => {
      // This promise will resolve only after the handler has been called.
      const gingeePromise = gingee(handler);

      // In parallel, we simulate the stream events.
      mockStore.req.emit("data", Buffer.from(data));
      mockStore.req.emit("end");

      // Await the completion of the middleware's logic.
      await gingeePromise;
    });

    // Now that the whole process is complete, we can make our assertions.
    expect(handler).toHaveBeenCalledTimes(1);
    const $g = handler.mock.calls[0][0];
    expect($g.request.body).toEqual({ key: "value" });
  });

  test("should skip the handler if response is already completed by middleware", async () => {
    await als.run(mockStore, async () => {
      // --- Simulate a middleware run ---
      // Create a fake $g object for the first run
      mockStore.$g = {
        response: {
          send: (data, status) => {
            mockStore.$g.isCompleted = true; // The real 'send' would do this
          },
        },
      };

      // The "middleware" sends the response
      mockStore.$g.response.send("Redirecting...", 302);

      // --- Now, simulate the main script run ---
      await gingee(handler);
    });

    // Verify the main handler was NEVER called
    expect(handler).not.toHaveBeenCalled();
  });

  test("should correctly handle a body-less POST request without hanging", async () => {
    mockReq.method = "POST";
    mockReq.headers["content-type"] = "application/json";
    mockReq.headers["content-length"] = "0"; // No body

    await als.run(mockStore, async () => {
      await gingee(handler);
    });

    // The test passes if it completes without timing out
    expect(handler).toHaveBeenCalledTimes(1);
    const $g = handler.mock.calls[0][0];
    expect($g.request.body).toBe(null);
  });

  // --- M1: Content-Type with parameters (charset) ---
  test("should parse JSON when Content-Type includes charset=utf-8", async () => {
    mockReq.url = "/test/post";
    mockReq.method = "POST";
    mockReq.headers["content-type"] = "application/json; charset=utf-8";
    const data = '{"hello":"world"}';
    mockReq.headers["content-length"] = `${Buffer.byteLength(data)}`;
    mockStore.req = mockReq;

    await als.run(mockStore, async () => {
      const gingeePromise = gingee(handler);
      mockStore.req.emit("data", Buffer.from(data));
      mockStore.req.emit("end");
      await gingeePromise;
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].request.body).toEqual({ hello: "world" });
  });

  test("should parse urlencoded when Content-Type includes charset", async () => {
    mockReq.url = "/test/form";
    mockReq.method = "POST";
    mockReq.headers["content-type"] =
      "application/x-www-form-urlencoded; charset=UTF-8";
    const data = "a=1&b=two";
    mockReq.headers["content-length"] = `${Buffer.byteLength(data)}`;
    mockStore.req = mockReq;

    await als.run(mockStore, async () => {
      const gingeePromise = gingee(handler);
      mockStore.req.emit("data", Buffer.from(data));
      mockStore.req.emit("end");
      await gingeePromise;
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].request.body).toEqual({ a: "1", b: "two" });
  });

  // --- M2: oversize body → 413 + destroy, handler not invoked ---
  test("should respond 413 and destroy when body exceeds maxBodySize", async () => {
    mockReq.url = "/test/big";
    mockReq.method = "POST";
    mockReq.headers["content-type"] = "application/json; charset=utf-8";
    mockReq.headers["content-length"] = "10000";
    mockReq.destroy = jest.fn();
    mockStore.maxBodySize = "10b"; // 10 bytes
    mockStore.req = mockReq;

    await als.run(mockStore, async () => {
      const gingeePromise = gingee(handler);
      mockStore.req.emit(
        "data",
        Buffer.from('{"x":"this is way too large for ten bytes"}'),
      );
      mockStore.req.emit("end");
      await gingeePromise;
    });

    expect(handler).not.toHaveBeenCalled();
    expect(mockRes.writeHead).toHaveBeenCalledWith(413, {
      "Content-Type": "text/plain",
    });
    expect(mockRes.end).toHaveBeenCalledWith("Payload Too Large");
    expect(mockReq.destroy).toHaveBeenCalled();
  });
});
