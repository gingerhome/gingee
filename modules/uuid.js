const crypto = require('crypto');

/**
 * @module uuid
 * @description Provides functions to generate and validate UUIDs (Universally Unique Identifiers).
 */

/**
 * @function v4
 * @memberof module:uuid
 * @description Generates a random RFC 4122 Version 4 UUID.
 * Uses the built-in, cryptographically secure random UUID generator.
 * @returns {string} A new UUID string (e.g., "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d").
 * @example
 * const uuid = require('uuid');
 * const newUuid = uuid.v4();
 * console.log(newUuid); // Outputs a random UUID
 */
function v4() {
    // crypto.randomUUID() is the modern, fast, and secure way to generate UUIDs.
    return crypto.randomUUID();
}

/**
 * @function validate
 * @memberof module:uuid
 * @description Validates if a string is a correctly formatted UUID.
 * This function checks if the string matches the standard UUID format (8-4-4-4-12 hex digits).
 * It does not check if the UUID is actually in use or registered, only its format.
 * @param {string} uuidString The string to validate.
 * @returns {boolean} True if the string is a valid UUID, false otherwise.
 * @example
 * const uuid = require('uuid');
 * const isValid = uuid.validate('a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
 * console.log(isValid); // Outputs true or false
 */
function validate(uuidString) {
    if (typeof uuidString !== 'string') {
        return false;
    }
    // This regex checks for the standard 8-4-4-4-12 hex format of a UUID.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuidString);
}

module.exports = {
    v4,
    validate
};
