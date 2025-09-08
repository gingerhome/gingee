// Import from installed dependencies
const crc32 = require('crc-32');
const { sha3_256 } = require('js-sha3');
const argon2 = require('argon2');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits for GCM
const AUTH_TAG_LENGTH = 16;

const LETTERS_ONLY = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTERS_AND_NUMBERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

// Import from Node.js built-in module
// Our sandbox allows this require because 'crypto' is in the whitelist.
const nodeCrypto = require('crypto');

/**
 * @function CRC32
 * @memberof module:crypto
 * @description Computes the CRC32 checksum for a string.
 * @param {string} inputString The string to process.
 * @returns {number} The CRC32 checksum as an integer.
 * @example
 * const checksum = crypto.CRC32("Hello, World!");
 * console.log("CRC32 Checksum:", checksum);
 */
function CRC32(inputString) {
    // The library works with buffers; the second argument is a seed.
    return crc32.buf(Buffer.from(inputString, 'utf8'), 0);
}

/**
 * @function MD5
 * @memberof module:crypto
 * @description Computes the MD5 hash for a string.
 * @param {string} inputString The string to process.
 * @returns {string} The MD5 hash as a hex string.
 * @example
 * const hash = crypto.MD5("Hello, World!");
 * console.log("MD5 Hash:", hash);
 */
function MD5(inputString) {
    return nodeCrypto.createHash('md5').update(inputString).digest('hex');
}

/**
 * @function SHA2
 * @memberof module:crypto
 * @description Computes the SHA256 hash for a string. (SHA2 is a family, SHA256 is the most common)
 * @param {string} inputString The string to process.
 * @returns {string} The SHA256 hash as a hex string.
 * @example
 * const hash = crypto.SHA2("Hello, World!");
 * console.log("SHA256 Hash:", hash);
 */
function SHA2(inputString) {
    return nodeCrypto.createHash('sha256').update(inputString).digest('hex');
}

/**
 * @function SHA3
 * @memberof module:crypto
 * @description Computes the SHA3-256 hash for a string.
 * @param {string} inputString The string to process.
 * @returns {string} The SHA3-256 hash as a hex string.
 * @example
 * const hash = crypto.SHA3("Hello, World!");
 * console.log("SHA3-256 Hash:", hash);
 */
function SHA3(inputString) {
    return sha3_256(inputString);
}

/**
 * @function hmacSha256Encrypt
 * @memberof module:crypto
 * @description Encrypts (signs) a string using HMAC-SHA256.
 * @param {string} inputString The string to encrypt/sign.
 * @param {string} secret The secret key.
 * @returns {string} The HMAC signature as a hex string.
 * @example
 * const signature = crypto.hmacSha256Encrypt("Hello, World!", "my-secret");
 * console.log("HMAC-SHA256 Signature:", signature);
 */
function hmacSha256Encrypt(inputString, secret) {
    return nodeCrypto.createHmac('sha256', secret).update(inputString).digest('hex');
}

/**
 * @function hmacSha256Verify
 * @memberof module:crypto
 * @description Verifies an HMAC-SHA256 signature.
 * @param {string} encryptedString The signature (hex string) to verify.
 * @param {string} originalString The original, unencrypted string.
 * @param {string} secret The secret key used for signing.
 * @returns {boolean} True if the signature is valid, false otherwise.
 * @example
 * const isValid = crypto.hmacSha256Verify(signature, "Hello, World!", "my-secret");
 * console.log("Is the signature valid? - ", isValid);
 */
function hmacSha256Verify(encryptedString, originalString, secret) {
    const expectedSignature = hmacSha256Encrypt(originalString, secret);
    // Use crypto.timingSafeEqual for security against timing attacks.
    try {
        return nodeCrypto.timingSafeEqual(
            Buffer.from(encryptedString, 'hex'),
            Buffer.from(expectedSignature, 'hex')
        );
    } catch (e) {
        // This can happen if buffers have different lengths, which means they don't match.
        return false;
    }
}

/**
 * @private
 * @function _deriveKey
 * @description Derives a 32-byte key from a secret string using SHA-256.
 * @param {string} secret The secret to derive the key from.
 * @returns {Buffer} A 32-byte Buffer suitable for AES-256.
 * @private
 */
function _deriveKey(secret) {
    // SHA-256 produces a 256-bit (32-byte) hash, which is the exact size needed for an AES-256 key.
    // This is a more direct and standard way to derive a key than slicing a base64 string.
    return nodeCrypto.createHash('sha256').update(String(secret)).digest();
}

/**
 * @function encrypt
 * @memberof module:crypto
 * @description Encrypts text using AES-256-GCM.
 * @param {string} textToEncrypt The plaintext string.
 * @param {string} secret The secret key to use for encryption.
 * @returns {string} A combined string "iv:authtag:encryptedtext" in hex format.
 * @example
 * const encrypted = crypto.encrypt("Hello, World!", "my-secret");
 * console.log("Encrypted Text:", encrypted);
 */
function encrypt(textToEncrypt, secret) {
    const key = _deriveKey(secret); // Use the new key derivation function
    const iv = nodeCrypto.randomBytes(IV_LENGTH);
    const cipher = nodeCrypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(textToEncrypt, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * @function decrypt
 * @memberof module:crypto
 * @description Decrypts text that was encrypted with the encrypt() function.
 * @param {string} encryptedPackage The "iv:authtag:encryptedtext" string.
 * @param {string} secret The secret key used for encryption.
 * @returns {string|null} The original plaintext or null if decryption fails.
 * @example
 * const decrypted = crypto.decrypt("iv:authtag:encryptedtext", "my-secret");
 * console.log("Decrypted Text:", decrypted);
 * @throws {Error} If the decryption fails due to an invalid format or other issues.
 */
function decrypt(encryptedPackage, secret) {
    try {
        const key = _deriveKey(secret); // Use the same key derivation function
        const parts = encryptedPackage.split(':');

        if (parts.length !== 3) {
            throw new Error("Invalid encrypted package format.");
        }

        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encryptedText = parts[2];

        const decipher = nodeCrypto.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (err) {
        return null;
    }
}

/**
 * @function hashPassword
 * @memberof module:crypto
 * @description Securely hashes a password using Argon2.
 * @param {string} plainTextPassword The user's password.
 * @returns {Promise<string>} A promise that resolves to the full hash string.
 * @example
 * const hash = await crypto.hashPassword("mySecurePassword");
 * console.log("Hashed Password:", hash);
 */
async function hashPassword(plainTextPassword) {
    // The hash function automatically generates a secure salt.
    // The returned hash contains the algorithm, parameters, salt, and hash.
    return argon2.hash(plainTextPassword);
}

/**
 * @function verifyPassword
 * @memberof module:crypto
 * @description Verifies a plaintext password against an Argon2 hash.
 * @param {string} plainTextPassword The password to check.
 * @param {string} hash The hash string from the database.
 * @returns {Promise<boolean>} A promise that resolves to true if they match, false otherwise.
 * @example
 * const isValid = await crypto.verifyPassword("mySecurePassword", hash);
 * console.log("Is the password valid? - ", isValid);
 */
async function verifyPassword(plainTextPassword, hash) {
    try {
        return await argon2.verify(hash, plainTextPassword);
    } catch (err) {
        return false;
    }
}

/**
 * @function generateSecureRandomString
 * @memberof module:crypto
 * @description Generates a cryptographically secure random string.
 * @param {number} length The desired length of the final string.
 * @returns {string} A random, URL-safe string.
 * @example
 * const randomString = crypto.generateSecureRandomString(32);
 * console.log("Random String:", randomString);
 */
function generateSecureRandomString(length = 32, onlyLetters = false) {
    // Generates a random buffer and converts it to a hex string.
    // We generate length/2 bytes because each byte becomes 2 hex characters.
    
    if (length <= 0) {
        return '';
    }

    // Choose the character set based on the 'numbers' option.
    const characterSet = onlyLetters ? LETTERS_ONLY : LETTERS_AND_NUMBERS;
    const characterSetLength = characterSet.length;

    let result = '';
    // Generate a buffer of random bytes.
    // We generate one byte for each character we need.
    const randomBytes = nodeCrypto.randomBytes(length);

    for (let i = 0; i < length; i++) {
        // For each byte, we get a value between 0 and 255.
        // We use the modulo operator to map this to an index within our character set.
        // This gives us a reasonably uniform random character from the set.
        const randomIndex = randomBytes[i] % characterSetLength;
        result += characterSet[randomIndex];
    }

    return result;
}

/**
 * @module crypto
 * @description Provides cryptographic functions for hashing, encryption, and secure random string generation.
 */
module.exports = {
    CRC32,
    MD5,
    SHA2,
    SHA3,
    hmacSha256Encrypt,
    hmacSha256Verify,
    encrypt,
    decrypt,
    hashPassword,
    verifyPassword,
    generateSecureRandomString
};
