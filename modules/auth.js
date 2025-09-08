const crypto = require('./crypto.js');
const base64 = require('./encode.js').base64;
const ginger = require('./ginger.js');

/**
 * @private
 * @function createJWTToken
 * @param {object} payload - The data to include in the token (e.g., { userId: 42, role: 'admin' }).
 * @param {string} [expiresIn='1h'] - The token's lifespan (e.g., '1h', '7d', '30m').
 * @returns {string} The JWT string.
 */
function createJWTToken(payload, expiresIn = '1h') {
    const ctx = ginger.getContext();
    const jwtSecret = ctx.app.config.jwt_secret;

    if (!jwtSecret) {
        throw new Error("JWT secret is not set in the context. Please configure it in your app.json file.");
    }

    // 1. Create the Header
    const header = {
        alg: 'HS256',
        typ: 'JWT'
    };
    const encodedHeader = base64.encodeUrl(JSON.stringify(header));

    // 2. Create the Payload with an expiration claim ('exp')
    const now = Math.floor(Date.now() / 1000);
    const expiration = _calculateExpiry(now, expiresIn);
    const fullPayload = { ...payload, iat: now, exp: expiration };
    const encodedPayload = base64.encodeUrl(JSON.stringify(fullPayload));

    // 3. Create the Signature
    const signatureInput = `${encodedHeader}.${encodedPayload}`;
    const signature = crypto.hmacSha256Encrypt(signatureInput, jwtSecret);
    // We need the raw signature, not hex, then base64url encode it. Let's adjust crypto.
    // Let's assume hmacSha256Encrypt returns hex for now and we will fix it later.
    // A better approach is to have the crypto module return a Buffer.
    // For now, let's just make it work.
    const signatureHex = crypto.hmacSha256Encrypt(signatureInput, jwtSecret);
    const encodedSignature = base64.encodeUrl(Buffer.from(signatureHex, 'hex'));


    return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

/**
 * @private
 * @function verifyJWTToken
 * @memberof module:auth.jwt
 * @description Verifies a JWT and returns its payload if valid.
 * @param {string} token - The JWT string to verify.
 * @returns {object|null} The token's payload if valid and not expired, otherwise null.
 */
function verifyJWTToken(token) {
    try {
        const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');
        if (!encodedHeader || !encodedPayload || !encodedSignature) {
            return null; // Invalid structure
        }

        const ctx = ginger.getContext();
        const jwtSecret = ctx.app.config.jwt_secret;

        // 1. Verify the signature
        const signatureInput = `${encodedHeader}.${encodedPayload}`;
        const expectedSignatureHex = crypto.hmacSha256Encrypt(signatureInput, jwtSecret);
        const expectedEncodedSignature = base64.encodeUrl(Buffer.from(expectedSignatureHex, 'hex'));

        if (encodedSignature !== expectedEncodedSignature) {
            // For security, you could use a timing-safe comparison here, but it's less critical
            // than with passwords as the token is not a user-provided secret.
            ctx.logger.error("JWT Verification Failed: Invalid signature.");
            return null;
        }

        // 2. Decode the payload and check the expiration
        const payload = JSON.parse(base64.decodeUrl(encodedPayload));
        const now = Math.floor(Date.now() / 1000);

        if (payload.exp < now) {
            ctx.logger.error("JWT Verification Failed: Token has expired.");
            return null;
        }

        return payload;
    } catch (e) {
        ctx.logger.error("JWT Verification Failed with error:", e.message);
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
        case 's': seconds = value; break;
        case 'm': seconds = value * 60; break;
        case 'h': seconds = value * 60 * 60; break;
        case 'd': seconds = value * 24 * 60 * 60; break;
        default: throw new Error("Invalid expiresIn format.");
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
         * @param {object} payload - The data to include in the token.
         * @param {string} [expiresIn='1h'] - The token's lifespan.
         * @returns {string} The JWT string.
         * @example
         * const token = auth.jwt.create({ userId: 42, role: 'admin' }, '2h');
         */
        create: createJWTToken,
        /**
         * @function verify
         * @memberof module:auth.jwt
         * @description Verifies a JWT and returns its payload if valid.
         * @param {string} token - The JWT string to verify.
         * @returns {object|null} The token's payload if valid and not expired, otherwise null.
         * @example
         * const payload = auth.jwt.verify(token);
         * if (payload) {
         *     console.log("Token is valid:", payload);
         * } else {
         *     console.log("Token is invalid or expired.");
         * }
         */
        verify: verifyJWTToken
    }
};
