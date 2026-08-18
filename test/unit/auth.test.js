const { als } = require("../../modules/gingee");
const auth = require("../../modules/auth");

// We mock the dependencies of the auth module
jest.mock("../../modules/crypto");
jest.mock("../../modules/encode");
const crypto = require("../../modules/crypto");
const encode = require("../../modules/encode");

describe("auth.js - JWT Functionality", () => {
  const mockPayload = { userId: 42, role: "user" };
  const mockSecret = "test-jwt-secret";
  let mockAlsStore;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAlsStore = {
      app: { config: { jwt_secret: mockSecret } },
      globalConfig: { jwt: { secret: null, iss: null } },
      logger: { error: jest.fn() },
    };
  });

  test("createToken should generate a 3-part JWT string", () => {
    encode.base64.encodeUrl.mockImplementation((input) => {
      const str = Buffer.isBuffer(input) ? input.toString() : String(input);
      return `encoded_${str.substring(0, 10)}`;
    });
    crypto.hmacSha256Encrypt.mockReturnValue("fake_signature_hex");

    als.run(mockAlsStore, () => {
      const token = auth.jwt.create(mockPayload, "1h");
      expect(typeof token).toBe("string");
      expect(token.split(".").length).toBe(3);
    });
  });

  test("verifyToken should return payload for a valid token", () => {
    const realCrypto = jest.requireActual("../../modules/crypto");
    const realEncode = jest.requireActual("../../modules/encode");

    crypto.hmacSha256Encrypt.mockImplementation(realCrypto.hmacSha256Encrypt);
    encode.base64.encodeUrl.mockImplementation(realEncode.base64.encodeUrl);
    encode.base64.decodeUrl.mockImplementation(realEncode.base64.decodeUrl);

    als.run(mockAlsStore, () => {
      const token = auth.jwt.create(mockPayload, "1h");
      const verifiedPayload = auth.jwt.verify(token);

      expect(verifiedPayload).not.toBeNull();
      expect(verifiedPayload.userId).toBe(mockPayload.userId);
      expect(verifiedPayload.role).toBe(mockPayload.role);
      expect(verifiedPayload.exp).toBeDefined();
    });
  });

  test("verifyToken should return null for an expired token", () => {
    jest.useFakeTimers().setSystemTime(new Date("2023-01-01T12:00:00Z"));

    const realCrypto = jest.requireActual("../../modules/crypto");
    const realEncode = jest.requireActual("../../modules/encode");
    crypto.hmacSha256Encrypt.mockImplementation(realCrypto.hmacSha256Encrypt);
    encode.base64.encodeUrl.mockImplementation(realEncode.base64.encodeUrl);

    let expiredToken;
    als.run(mockAlsStore, () => {
      expiredToken = auth.jwt.create(mockPayload, "1h");
    });

    jest.advanceTimersByTime(2 * 60 * 60 * 1000);

    als.run(mockAlsStore, () => {
      const result = auth.jwt.verify(expiredToken);
      expect(result).toBeNull();
    });

    jest.useRealTimers();
  });

  test("falls back to server jwt.secret when app has none", () => {
    const realCrypto = jest.requireActual("../../modules/crypto");
    const realEncode = jest.requireActual("../../modules/encode");
    crypto.hmacSha256Encrypt.mockImplementation(realCrypto.hmacSha256Encrypt);
    encode.base64.encodeUrl.mockImplementation(realEncode.base64.encodeUrl);
    encode.base64.decodeUrl.mockImplementation(realEncode.base64.decodeUrl);

    const store = {
      app: { config: { jwt_secret: null } },
      globalConfig: { jwt: { secret: "server-secret", iss: null } },
      logger: { error: jest.fn() },
    };

    als.run(store, () => {
      const token = auth.jwt.create({ a: 1 }, "1h");
      const payload = auth.jwt.verify(token);
      expect(payload).not.toBeNull();
      expect(payload.a).toBe(1);
    });
  });

  test("sets and verifies iss when configured", () => {
    const realCrypto = jest.requireActual("../../modules/crypto");
    const realEncode = jest.requireActual("../../modules/encode");
    crypto.hmacSha256Encrypt.mockImplementation(realCrypto.hmacSha256Encrypt);
    encode.base64.encodeUrl.mockImplementation(realEncode.base64.encodeUrl);
    encode.base64.decodeUrl.mockImplementation(realEncode.base64.decodeUrl);

    mockAlsStore.app.config.jwt_iss = "tests-app";

    als.run(mockAlsStore, () => {
      const token = auth.jwt.create(mockPayload, "1h");
      const payload = auth.jwt.verify(token);
      expect(payload).not.toBeNull();
      expect(payload.iss).toBe("tests-app");
    });

    als.run(mockAlsStore, () => {
      const token = auth.jwt.create(mockPayload, "1h", { iss: "other" });
      expect(auth.jwt.verify(token)).toBeNull(); // expected iss still tests-app
      expect(auth.jwt.verify(token, { iss: "other" })).not.toBeNull();
    });
  });

  test("options.secret overrides app secret", () => {
    const realCrypto = jest.requireActual("../../modules/crypto");
    const realEncode = jest.requireActual("../../modules/encode");
    crypto.hmacSha256Encrypt.mockImplementation(realCrypto.hmacSha256Encrypt);
    encode.base64.encodeUrl.mockImplementation(realEncode.base64.encodeUrl);
    encode.base64.decodeUrl.mockImplementation(realEncode.base64.decodeUrl);

    als.run(mockAlsStore, () => {
      const token = auth.jwt.create(mockPayload, "1h", {
        secret: "override-secret",
      });
      expect(auth.jwt.verify(token)).toBeNull();
      expect(
        auth.jwt.verify(token, { secret: "override-secret" }),
      ).not.toBeNull();
    });
  });
});
