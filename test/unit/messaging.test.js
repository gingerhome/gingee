const { als } = require("../../modules/gingee");

const mockTwilioSend = jest.fn();
const mockTwilioShutdown = jest.fn();
const mockConsoleSend = jest.fn();
const mockMockSend = jest.fn();

jest.mock("../../modules/messaging_providers/twilio", () => {
  return jest
    .fn()
    .mockImplementation(function TwilioMock(config, app, logger) {
      this.config = config;
      this.app = app;
      this.logger = logger;
      this.send = mockTwilioSend;
      this.shutdown = mockTwilioShutdown;
    });
});

jest.mock("../../modules/messaging_providers/console", () => {
  return jest
    .fn()
    .mockImplementation(function ConsoleMock(config, app, logger) {
      this.config = config;
      this.app = app;
      this.logger = logger;
      this.send = mockConsoleSend;
      this.shutdown = jest.fn();
    });
});

jest.mock("../../modules/messaging_providers/mock", () => {
  return jest
    .fn()
    .mockImplementation(function MockMock(config, app, logger) {
      this.config = config;
      this.app = app;
      this.logger = logger;
      this.send = mockMockSend;
      this.shutdown = jest.fn();
    });
});

const TwilioAdapter = require("../../modules/messaging_providers/twilio");
const ConsoleAdapter = require("../../modules/messaging_providers/console");
const MockAdapter = require("../../modules/messaging_providers/mock");
const messaging = require("../../modules/messaging");

describe("messaging.js - provider adapter & runtime sendWithConfig", () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    messaging._resetForTests();

    mockMockSend.mockResolvedValue({
      messageId: "mock-msg-1",
      provider: "mock",
      status: "logged",
      to: "+15551234567",
      body: "Test mock body",
    });
    mockConsoleSend.mockResolvedValue({
      messageId: "console-msg-1",
      provider: "console",
      status: "logged",
      to: "+15551234567",
      body: "Test console body",
    });
    mockTwilioSend.mockResolvedValue({
      messageId: "SM1234567890",
      provider: "twilio",
      status: "sent",
      to: "+15551234567",
      from: "+15550001111",
    });
  });

  test("merge order: server < app < runtime override", () => {
    const merged = messaging._mergeMessagingConfig(
      { type: "mock", from: "+15550000000" },
      { type: "twilio", account_sid: "AC_app", auth_token: "token_app" },
      { from: "+15559999999" },
    );
    expect(merged).toEqual({
      type: "twilio",
      account_sid: "AC_app",
      auth_token: "token_app",
      from: "+15559999999",
    });
  });

  test("send uses mock adapter from app config (overrides server twilio type)", async () => {
    messaging.initServer(
      { type: "twilio", account_sid: "AC_server", auth_token: "token_server" },
      logger,
    );
    const app = {
      name: "demo",
      config: {
        messaging: { type: "mock", from: "+15550001111" },
      },
    };
    messaging.initApp(app, logger);
    expect(MockAdapter).toHaveBeenCalled();
    expect(TwilioAdapter).not.toHaveBeenCalled();

    await als.run({ appName: "demo", app, logger }, async () => {
      const result = await messaging.send({
        to: "+15551234567",
        body: "Hello mock",
      });
      expect(result.provider).toBe("mock");
      expect(mockMockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "+15551234567",
          body: "Hello mock",
        }),
      );
      expect(mockTwilioSend).not.toHaveBeenCalled();
    });
  });

  test("send uses console adapter when configured with console / dev alias", async () => {
    const app = {
      name: "demo_console",
      config: {
        messaging: { type: "console", from: "+15550002222" },
      },
    };
    messaging.initApp(app, logger);
    expect(ConsoleAdapter).toHaveBeenCalled();

    await als.run({ appName: "demo_console", app, logger }, async () => {
      const result = await messaging.send({
        to: "+15551234567",
        text: "Hello console text",
      });
      expect(result.provider).toBe("console");
      expect(mockConsoleSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "+15551234567",
          body: "Hello console text",
        }),
      );
    });
  });

  test("send uses twilio adapter when configured", async () => {
    const app = {
      name: "demo_twilio",
      config: {
        messaging: {
          type: "twilio",
          account_sid: "AC123",
          auth_token: "auth123",
          from: "+15550003333",
        },
      },
    };
    messaging.initApp(app, logger);
    expect(TwilioAdapter).toHaveBeenCalled();

    await als.run({ appName: "demo_twilio", app, logger }, async () => {
      const result = await messaging.send({
        to: "+15551234567",
        body: "Hello Twilio",
        mediaUrl: "https://example.com/image.png",
      });
      expect(result.provider).toBe("twilio");
      expect(mockTwilioSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "+15551234567",
          body: "Hello Twilio",
          mediaUrl: ["https://example.com/image.png"],
        }),
      );
    });
  });

  test("send throws when no messaging type is configured", async () => {
    messaging.initServer(null, logger);
    const app = { name: "empty", config: {} };
    messaging.initApp(app, logger);

    await als.run({ appName: "empty", app, logger }, async () => {
      await expect(
        messaging.send({ to: "+15551234567", body: "test" }),
      ).rejects.toThrow(/No messaging configuration/);
    });
  });

  test("send validates required message fields (to, body/mediaUrl/contentSid)", async () => {
    const app = {
      name: "demo",
      config: { messaging: { type: "mock", from: "+15550001111" } },
    };
    messaging.initApp(app, logger);

    await als.run({ appName: "demo", app, logger }, async () => {
      await expect(messaging.send(null)).rejects.toThrow(/requires a message object/);
      await expect(messaging.send({})).rejects.toThrow(/'to' recipient/);
      await expect(
        messaging.send({ to: [] }),
      ).rejects.toThrow(/'to' recipient/);
      await expect(
        messaging.send({ to: "+15551234567" }),
      ).rejects.toThrow(/'body'/);
      await expect(
        messaging.send({ to: "+15551234567", channel: "fax" }),
      ).rejects.toThrow(/Unsupported messaging channel/);
    });
  });

  test("normalizeMessage defaults channel to sms and accepts whatsapp + contentSid", () => {
    expect(
      messaging._normalizeMessage({ to: "+1", body: "hi" }).channel,
    ).toBe("sms");
    expect(
      messaging._normalizeMessage({ to: "+1", body: "hi", channel: "mms" })
        .channel,
    ).toBe("sms");
    expect(
      messaging._normalizeMessage({
        to: "+1",
        channel: "whatsapp",
        contentSid: "HXabc",
        contentVariables: { "1": "Ada" },
      }),
    ).toEqual(
      expect.objectContaining({
        channel: "whatsapp",
        contentSid: "HXabc",
        contentVariables: { "1": "Ada" },
        body: "",
      }),
    );
  });

  test("send forwards channel and contentSid to adapter", async () => {
    const app = {
      name: "demo_wa",
      config: { messaging: { type: "mock", from: "+15550001111" } },
    };
    messaging.initApp(app, logger);

    await als.run({ appName: "demo_wa", app, logger }, async () => {
      await messaging.send({
        channel: "whatsapp",
        to: "+15551234567",
        contentSid: "HXtemplate",
        contentVariables: { "1": "GinBon" },
      });
      expect(mockMockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "whatsapp",
          to: "+15551234567",
          contentSid: "HXtemplate",
          contentVariables: { "1": "GinBon" },
        }),
      );
    });
  });

  test("sendWithConfig overrides app/server for one transaction only", async () => {
    messaging.initServer({ type: "mock", from: "+15550000000" }, logger);
    const app = {
      name: "demo",
      config: { messaging: { type: "mock", from: "+15550001111" } },
    };
    messaging.initApp(app, logger);
    jest.clearAllMocks();

    mockMockSend.mockResolvedValue({
      messageId: "mock-msg-1",
      provider: "mock",
      status: "logged",
    });
    mockTwilioSend.mockResolvedValue({
      messageId: "SM999",
      provider: "twilio",
      status: "sent",
    });

    await als.run({ appName: "demo", app, logger }, async () => {
      const result = await messaging.sendWithConfig(
        {
          type: "twilio",
          account_sid: "AC_runtime",
          auth_token: "token_runtime",
          from: "+15559990000",
        },
        {
          to: "+15551234567",
          body: "Runtime override SMS",
        },
      );

      expect(result.provider).toBe("twilio");
      expect(result.status).toBe("sent");
      expect(TwilioAdapter).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "twilio",
          account_sid: "AC_runtime",
          auth_token: "token_runtime",
          from: "+15559990000",
        }),
        app,
        logger,
      );
      expect(mockTwilioSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "+15551234567",
          body: "Runtime override SMS",
        }),
      );
      expect(mockTwilioShutdown).toHaveBeenCalled();

      // Default path is still mock - runtime override must not persist
      const next = await messaging.send({
        to: "+15551234567",
        body: "Still mock",
      });
      expect(next.provider).toBe("mock");
      expect(mockMockSend).toHaveBeenCalled();
    });
  });

  test("sendWithConfig works when app has no default messaging config", async () => {
    messaging.initServer({}, logger);
    const app = { name: "bare", config: {} };
    messaging.initApp(app, logger);

    await als.run({ appName: "bare", app, logger }, async () => {
      const result = await messaging.sendWithConfig(
        { type: "mock", from: "+15550001234" },
        { to: "+15551234567", body: "One-off mock" },
      );
      expect(result.provider).toBe("mock");
      expect(MockAdapter).toHaveBeenCalledWith(
        expect.objectContaining({ type: "mock", from: "+15550001234" }),
        app,
        logger,
      );
    });
  });

  test("sendWithConfig validates config object parameter", async () => {
    const app = { name: "bare", config: {} };
    await als.run({ appName: "bare", app, logger }, async () => {
      await expect(
        messaging.sendWithConfig(null, { to: "+123", body: "test" }),
      ).rejects.toThrow(/requires a config object/);
      await expect(
        messaging.sendWithConfig({}, { to: "+123", body: "test" }),
      ).rejects.toThrow(/resolved config has no 'type'/);
    });
  });

  test("shutdownApp and reinitApp swap provider cleanly", async () => {
    const app = {
      name: "demo",
      config: { messaging: { type: "mock", from: "+15550001111" } },
    };
    messaging.initApp(app, logger);
    await messaging.shutdownApp("demo", logger);

    app.config.messaging = {
      type: "twilio",
      account_sid: "AC_new",
      auth_token: "token_new",
      from: "+15550009999",
    };
    await messaging.reinitApp("demo", app, logger);
    expect(TwilioAdapter).toHaveBeenCalled();

    await als.run({ appName: "demo", app, logger }, async () => {
      const result = await messaging.send({
        to: "+15551234567",
        body: "Re-init check",
      });
      expect(result.provider).toBe("twilio");
      expect(mockTwilioSend).toHaveBeenCalled();
    });
  });
});
