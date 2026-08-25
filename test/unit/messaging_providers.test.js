const MockMessagingAdapter = require("../../modules/messaging_providers/mock");
const ConsoleMessagingAdapter = require("../../modules/messaging_providers/console");

// Mock internal_utils loadOptional for Twilio provider test
const mockTwilioMessagesCreate = jest.fn();
const mockTwilioFactory = jest.fn().mockImplementation(() => ({
  messages: {
    create: mockTwilioMessagesCreate,
  },
}));

jest.mock("../../modules/internal_utils", () => {
  const actual = jest.requireActual("../../modules/internal_utils");
  return {
    ...actual,
    loadOptional: jest.fn((loader, pkgName, feature) => {
      if (pkgName === "twilio") {
        return mockTwilioFactory;
      }
      return loader();
    }),
  };
});

const TwilioMessagingAdapter = require("../../modules/messaging_providers/twilio");
const { loadOptional } = require("../../modules/internal_utils");

describe("Messaging Providers", () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const mockApp = { name: "test_app" };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("MockMessagingAdapter", () => {
    test("sends mock message and logs info", async () => {
      const adapter = new MockMessagingAdapter(
        { type: "mock", from: "+15550001111" },
        mockApp,
        mockLogger,
      );
      const res = await adapter.send({
        to: "+15551234567",
        body: "Mock message body",
        mediaUrl: ["https://example.com/sample.png"],
      });

      expect(res.provider).toBe("mock");
      expect(res.status).toBe("logged");
      expect(res.to).toBe("+15551234567");
      expect(res.from).toBe("+15550001111");
      expect(res.body).toBe("Mock message body");
      expect(res.mediaUrl).toEqual(["https://example.com/sample.png"]);
      expect(res.channel).toBe("sms");
      expect(res.messageId).toMatch(/^mock-msg-/);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("[messaging:mock]"),
        expect.objectContaining({
          to: "+15551234567",
          from: "+15550001111",
          body: "Mock message body",
        }),
      );
    });

    test("logs WhatsApp channel and content template fields", async () => {
      const adapter = new MockMessagingAdapter(
        { type: "mock", from: "+15550001111" },
        mockApp,
        mockLogger,
      );
      const res = await adapter.send({
        channel: "whatsapp",
        to: "+15551234567",
        contentSid: "HXabc",
        contentVariables: { "1": "Ada" },
        body: "",
      });
      expect(res.channel).toBe("whatsapp");
      expect(res.contentSid).toBe("HXabc");
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("[messaging:mock]"),
        expect.objectContaining({
          channel: "whatsapp",
          contentSid: "HXabc",
          contentVariables: { "1": "Ada" },
        }),
      );
    });

    test("message from overrides config from", async () => {
      const adapter = new MockMessagingAdapter(
        { type: "mock", from: "+15550001111" },
        mockApp,
        mockLogger,
      );
      const res = await adapter.send({
        to: "+15551234567",
        from: "+15559998888",
        body: "Custom from",
      });
      expect(res.from).toBe("+15559998888");
    });
  });

  describe("ConsoleMessagingAdapter", () => {
    test("logs console message and returns logged status", async () => {
      const adapter = new ConsoleMessagingAdapter(
        { type: "console", from: "+15550002222" },
        mockApp,
        mockLogger,
      );
      const res = await adapter.send({
        to: "+15551234567",
        body: "Console message body",
      });

      expect(res.provider).toBe("console");
      expect(res.status).toBe("logged");
      expect(res.to).toBe("+15551234567");
      expect(res.from).toBe("+15550002222");
      expect(res.messageId).toMatch(/^console-msg-/);
      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining("[messaging:console]"),
        expect.objectContaining({
          to: "+15551234567",
          body: "Console message body",
        }),
      );
    });
  });

  describe("TwilioMessagingAdapter", () => {
    test("validates missing account_sid and auth_token", () => {
      expect(
        () => new TwilioMessagingAdapter({}, mockApp, mockLogger),
      ).toThrow(/missing 'account_sid'/);

      expect(
        () =>
          new TwilioMessagingAdapter(
            { account_sid: "AC123" },
            mockApp,
            mockLogger,
          ),
      ).toThrow(/missing 'auth_token'/);
    });

    test("initializes with account_sid and auth_token", () => {
      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC12345",
          auth_token: "token12345",
          from: "+15550003333",
        },
        mockApp,
        mockLogger,
      );
      expect(adapter).toBeDefined();
      expect(mockTwilioFactory).toHaveBeenCalledWith("AC12345", "token12345");
    });

    test("initializes with api_key and api_secret", () => {
      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC12345",
          api_key: "SK123",
          api_secret: "secret123",
          from: "+15550003333",
        },
        mockApp,
        mockLogger,
      );
      expect(adapter).toBeDefined();
      expect(mockTwilioFactory).toHaveBeenCalledWith("SK123", "secret123", {
        accountSid: "AC12345",
      });
    });

    test("throws if neither from nor messagingServiceSid is provided", async () => {
      const adapter = new TwilioMessagingAdapter(
        { account_sid: "AC123", auth_token: "token123" },
        mockApp,
        mockLogger,
      );
      await expect(
        adapter.send({ to: "+15551234567", body: "Hello" }),
      ).rejects.toThrow(/Messaging 'from' number or 'messagingServiceSid' is required/);
    });

    test("sends message via Twilio client with from and statusCallback", async () => {
      mockTwilioMessagesCreate.mockResolvedValueOnce({
        sid: "SMabcdef123456",
        status: "queued",
        to: "+15551234567",
        from: "+15550003333",
        dateCreated: "2026-08-24T00:00:00Z",
        numSegments: "1",
        price: "0.0075",
        priceUnit: "USD",
      });

      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC123",
          auth_token: "token123",
          from: "+15550003333",
          status_callback: "https://example.com/callback",
        },
        mockApp,
        mockLogger,
      );

      const res = await adapter.send({
        to: "+15551234567",
        body: "Twilio test message",
        mediaUrl: ["https://example.com/media.jpg"],
      });

      expect(mockTwilioMessagesCreate).toHaveBeenCalledWith({
        to: "+15551234567",
        from: "+15550003333",
        body: "Twilio test message",
        mediaUrl: ["https://example.com/media.jpg"],
        statusCallback: "https://example.com/callback",
      });

      expect(res).toEqual({
        messageId: "SMabcdef123456",
        provider: "twilio",
        channel: "sms",
        status: "queued",
        sid: "SMabcdef123456",
        to: "+15551234567",
        from: "+15550003333",
        dateCreated: "2026-08-24T00:00:00Z",
        numSegments: "1",
        price: "0.0075",
        priceUnit: "USD",
        contentSid: undefined,
      });
    });

    test("sends message using messagingServiceSid", async () => {
      mockTwilioMessagesCreate.mockResolvedValueOnce({
        sid: "SMmsid999",
        status: "sent",
        to: "+15551234567",
        from: null,
      });

      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC123",
          auth_token: "token123",
          messaging_service_sid: "MG123456",
        },
        mockApp,
        mockLogger,
      );

      const res = await adapter.send({
        to: "+15551234567",
        body: "Using service SID",
      });

      expect(mockTwilioMessagesCreate).toHaveBeenCalledWith({
        to: "+15551234567",
        messagingServiceSid: "MG123456",
        body: "Using service SID",
      });
      expect(res.sid).toBe("SMmsid999");
    });

    test("sends to multiple recipients when to is an array", async () => {
      mockTwilioMessagesCreate
        .mockResolvedValueOnce({ sid: "SM1", status: "sent", to: "+15551111111" })
        .mockResolvedValueOnce({ sid: "SM2", status: "sent", to: "+15552222222" });

      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC123",
          auth_token: "token123",
          from: "+15550003333",
        },
        mockApp,
        mockLogger,
      );

      const res = await adapter.send({
        to: ["+15551111111", "+15552222222"],
        body: "Broadcast test",
      });

      expect(mockTwilioMessagesCreate).toHaveBeenCalledTimes(2);
      expect(res.messageId).toBe("SM1,SM2");
      expect(res.provider).toBe("twilio");
      expect(res.status).toBe("sent");
      expect(res.results).toHaveLength(2);
    });

    test("prefixes whatsapp: on to/from and uses whatsapp_from", async () => {
      mockTwilioMessagesCreate.mockResolvedValueOnce({
        sid: "SMwa1",
        status: "queued",
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
      });

      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC123",
          auth_token: "token123",
          from: "+15550003333",
          whatsapp_from: "+14155238886",
        },
        mockApp,
        mockLogger,
      );

      const res = await adapter.send({
        channel: "whatsapp",
        to: "+15551234567",
        body: "WhatsApp hello",
      });

      expect(mockTwilioMessagesCreate).toHaveBeenCalledWith({
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
        body: "WhatsApp hello",
      });
      expect(res.channel).toBe("whatsapp");
      expect(res.sid).toBe("SMwa1");
    });

    test("does not double-prefix existing whatsapp: addresses", async () => {
      mockTwilioMessagesCreate.mockResolvedValueOnce({
        sid: "SMwa2",
        status: "queued",
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
      });

      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC123",
          auth_token: "token123",
          from: "+14155238886",
        },
        mockApp,
        mockLogger,
      );

      await adapter.send({
        channel: "whatsapp",
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
        body: "Already prefixed",
      });

      expect(mockTwilioMessagesCreate).toHaveBeenCalledWith({
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
        body: "Already prefixed",
      });
    });

    test("sends WhatsApp Content Template via contentSid and contentVariables", async () => {
      mockTwilioMessagesCreate.mockResolvedValueOnce({
        sid: "SMtpl1",
        status: "queued",
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
      });

      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC123",
          auth_token: "token123",
          whatsapp_from: "+14155238886",
        },
        mockApp,
        mockLogger,
      );

      await adapter.send({
        channel: "whatsapp",
        to: "+15551234567",
        contentSid: "HXxxxxxxxx",
        contentVariables: { "1": "Ada", "2": "42" },
      });

      expect(mockTwilioMessagesCreate).toHaveBeenCalledWith({
        to: "whatsapp:+15551234567",
        from: "whatsapp:+14155238886",
        contentSid: "HXxxxxxxxx",
        contentVariables: JSON.stringify({ "1": "Ada", "2": "42" }),
      });
    });

    test("SMS path unchanged when channel omitted", async () => {
      mockTwilioMessagesCreate.mockResolvedValueOnce({
        sid: "SMsms1",
        status: "sent",
        to: "+15551234567",
        from: "+15550003333",
      });

      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC123",
          auth_token: "token123",
          from: "+15550003333",
          whatsapp_from: "+14155238886",
        },
        mockApp,
        mockLogger,
      );

      await adapter.send({
        to: "+15551234567",
        body: "Plain SMS",
      });

      expect(mockTwilioMessagesCreate).toHaveBeenCalledWith({
        to: "+15551234567",
        from: "+15550003333",
        body: "Plain SMS",
      });
    });

    test("logs error and re-throws when Twilio API fails", async () => {
      mockTwilioMessagesCreate.mockRejectedValueOnce(
        new Error("Twilio API Error 21211: Invalid 'To' Phone Number"),
      );

      const adapter = new TwilioMessagingAdapter(
        {
          type: "twilio",
          account_sid: "AC123",
          auth_token: "token123",
          from: "+15550003333",
        },
        mockApp,
        mockLogger,
      );

      await expect(
        adapter.send({ to: "invalid-number", body: "Fail test" }),
      ).rejects.toThrow(/Twilio messaging send failed/);

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining("[messaging:twilio] Send failed"),
      );
    });
  });
});
