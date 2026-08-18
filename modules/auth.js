const crypto = require("./crypto.js");
const base64 = require("./encode.js").base64;
const gingee = require("./gingee.js");
const secrets = require("./secrets.js");

/**
 * Resolve optional options object; allow env:/file: refs via secrets.resolveDeep.
 * @private
 * @param {object|null|undefined} options
 * @returns {object}
 */
function _resolveJwtOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {};
  }
  try {
    return secrets.resolveDeep({ ...options }) || {};
  } catch (e) {
    throw new Error(
      `JWT options secret resolution failed: ${e && e.message ? e.message : e}`,
    );
  }
}

/**
 * Signing secret: options.secret → app.jwt_secret / app.jwt.secret → server jwt.secret
 * @private
 */
function _resolveJwtSecret(ctx, options) {
  const opts = _resolveJwtOptions(options);
  if (opts.secret != null && String(opts.secret) !== "") {
    return String(opts.secret);
  }

  const appCfg = (ctx.app && ctx.app.config) || {};
  if (appCfg.jwt_secret != null && String(appCfg.jwt_secret) !== "") {
    return String(appCfg.jwt_secret);
  }
  if (
    appCfg.jwt &&
    typeof appCfg.jwt === "object" &&
    appCfg.jwt.secret != null &&
    String(appCfg.jwt.secret) !== ""
  ) {
    return String(appCfg.jwt.secret);
  }

  const serverJwt =
    (ctx.globalConfig && ctx.globalConfig.jwt) ||
    (ctx.globalConfig && ctx.globalConfig.box && ctx.globalConfig.box.jwt) ||
    null;
  if (
    serverJwt &&
    typeof serverJwt === "object" &&
    serverJwt.secret != null &&
    String(serverJwt.secret) !== ""
  ) {
    return String(serverJwt.secret);
  }

  return null;
}

/**
 * Expected issuer: options.iss → app.jwt_iss / app.jwt.iss → server jwt.iss
 * Empty/null means do not set/enforce iss.
 * @private
 */
function _resolveJwtIss(ctx, options) {
  const opts = _resolveJwtOptions(options);
  if (Object.prototype.hasOwnProperty.call(opts, "iss")) {
    return opts.iss == null || opts.iss === "" ? null : String(opts.iss);
  }

  const appCfg = (ctx.app && ctx.app.config) || {};
  if (appCfg.jwt_iss != null && String(appCfg.jwt_iss) !== "") {
    return String(appCfg.jwt_iss);
  }
  if (
    appCfg.jwt &&
    typeof appCfg.jwt === "object" &&
    appCfg.jwt.iss != null &&
    String(appCfg.jwt.iss) !== ""
  ) {
    return String(appCfg.jwt.iss);
  }

  const serverJwt = (ctx.globalConfig && ctx.globalConfig.jwt) || null;
  if (
    serverJwt &&
    typeof serverJwt === "object" &&
    serverJwt.iss != null &&
    String(serverJwt.iss) !== ""
  ) {
    return String(serverJwt.iss);
  }

  return null;
}

/**
 * @private
 * @function createJWTToken
 * @param {object} payload - The data to include in the token (e.g., { userId: 42, role: 'admin' }).
 * @param {string} [expiresIn='1h'] - The token's lifespan (e.g., '1h', '7d', '30m').
 * @param {object} [options] - Optional overrides: `{ secret, iss }` (values may use env:/file: refs).
 * @returns {string} The JWT string.
 */
function createJWTToken(payload, expiresIn = "1h", options = {}) {
  // Allow create(payload, { secret, iss, expiresIn }) as a convenience.
  if (
    expiresIn &&
    typeof expiresIn === "object" &&
    !Array.isArray(expiresIn)
  ) {
    options = expiresIn;
    expiresIn = options.expiresIn || "1h";
  }

  const ctx = gingee.getContext();
  const jwtSecret = _resolveJwtSecret(ctx, options);

  if (!jwtSecret) {
    throw new Error(
      "JWT secret is not set. Configure app.json jwt_secret (or jwt.secret), " +
        "gingee.json jwt.secret, or pass options.secret. " +
        "Values may use env:VAR or file:path secret refs.",
    );
  }

  const header = {
    alg: "HS256",
    typ: "JWT",
  };
  const encodedHeader = base64.encodeUrl(JSON.stringify(header));

  const now = Math.floor(Date.now() / 1000);
  const expiration = _calculateExpiry(now, expiresIn);
  const fullPayload = { ...payload, iat: now, exp: expiration };

  const iss = _resolveJwtIss(ctx, options);
  if (iss && fullPayload.iss === undefined) {
    fullPayload.iss = iss;
  }

  const encodedPayload = base64.encodeUrl(JSON.stringify(fullPayload));

  const signatureInput = `${encodedHeader}.${encodedPayload}`;
  const signatureHex = crypto.hmacSha256Encrypt(signatureInput, jwtSecret);
  const encodedSignature = base64.encodeUrl(Buffer.from(signatureHex, "hex"));

  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * @private
 * @function verifyJWTToken
 * @memberof module:auth.jwt
 * @description Verifies a JWT and returns its payload if valid.
 * @param {string} token - The JWT string to verify.
 * @param {object} [options] - Optional overrides: `{ secret, iss }` (values may use env:/file: refs).
 * @returns {object|null} The token's payload if valid and not expired, otherwise null.
 */
function verifyJWTToken(token, options = {}) {
  let ctx = null;
  try {
    ctx = gingee.getContext();
    const [encodedHeader, encodedPayload, encodedSignature] = String(
      token || "",
    ).split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      return null; // Invalid structure
    }

    const jwtSecret = _resolveJwtSecret(ctx, options);
    if (!jwtSecret) {
      if (ctx.logger) {
        ctx.logger.error(
          "JWT Verification Failed: no jwt secret configured (app or server).",
        );
      }
      return null;
    }

    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignatureHex = crypto.hmacSha256Encrypt(
      signatureInput,
      jwtSecret,
    );
    const expectedEncodedSignature = base64.encodeUrl(
      Buffer.from(expectedSignatureHex, "hex"),
    );

    if (encodedSignature !== expectedEncodedSignature) {
      if (ctx.logger) {
        ctx.logger.error("JWT Verification Failed: Invalid signature.");
      }
      return null;
    }

    const payload = JSON.parse(base64.decodeUrl(encodedPayload));
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp == null || payload.exp < now) {
      if (ctx.logger) {
        ctx.logger.error("JWT Verification Failed: Token has expired.");
      }
      return null;
    }

    const expectedIss = _resolveJwtIss(ctx, options);
    if (expectedIss) {
      if (payload.iss !== expectedIss) {
        if (ctx.logger) {
          ctx.logger.error(
            `JWT Verification Failed: Invalid issuer (expected '${expectedIss}').`,
          );
        }
        return null;
      }
    }

    return payload;
  } catch (e) {
    if (ctx && ctx.logger) {
      ctx.logger.error(
        "JWT Verification Failed with error:",
        e && e.message ? e.message : e,
      );
    }
    return null;
  }
}

/**
 * A helper to calculate the 'exp' claim from a string like '1h' or '7d'.
 * @private
 */
function _calculateExpiry(startTime, expiresIn) {
  const unit = expiresIn.charAt(expiresIn.length - 1);
  const value = parseInt(expiresIn.slice(0, -1), 10);
  let seconds;
  switch (unit) {
    case "s":
      seconds = value;
      break;
    case "m":
      seconds = value * 60;
      break;
    case "h":
      seconds = value * 60 * 60;
      break;
    case "d":
      seconds = value * 24 * 60 * 60;
      break;
    default:
      throw new Error("Invalid expiresIn format.");
  }
  return startTime + seconds;
}

/**
 * @module auth
 * @description Provides authentication-related functions, including JWT creation and verification.
 */
module.exports = {
  /**
   * @namespace jwt
   * @memberof module:auth
   * @description Provides methods for creating and verifying JSON Web Tokens (JWTs).
   */
  jwt: {
    /**
     * @function create
     * @memberof module:auth.jwt
     * @description Creates a JSON Web Token (JWT) with the given payload and expiration.
     * Secret resolution: <code>options.secret</code> → <code>app.json</code> <code>jwt_secret</code> / <code>jwt.secret</code> →
     * <code>gingee.json</code> <code>jwt.secret</code>. Optional <code>iss</code> from options / app / server is set when configured.
     * @param {object} payload - The data to include in the token.
     * @param {string} [expiresIn='1h'] - The token's lifespan.
     * @param {object} [options] - Optional <code>{ secret, iss, expiresIn }</code> (secret/iss may use <code>env:</code> / <code>file:</code> refs).
     * @returns {string} The JWT string.
     * @example
     * const token = auth.jwt.create({ userId: 42, role: 'admin' }, '2h');
     */
    create: createJWTToken,
    /**
     * @function verify
     * @memberof module:auth.jwt
     * @description Verifies a JWT and returns its payload if valid (signature + exp; iss when configured).
     * @param {string} token - The JWT string to verify.
     * @param {object} [options] - Optional <code>{ secret, iss }</code> overrides (may use <code>env:</code> / <code>file:</code> refs).
     * @returns {object|null} The token's payload if valid and not expired, otherwise null.
     * @example
     * const payload = auth.jwt.verify(token);
     * if (payload) {
     *     console.log("Token is valid:", payload);
     * } else {
     *     console.log("Token is invalid or expired.");
     * }
     */
    verify: verifyJWTToken,
  },
};
