const he = require('he');
const bs58 = require('bs58');

/** * @module encode
 * @description Provides various encoding and decoding utilities for strings, including Base64, URI, hexadecimal, HTML, and Base58.
 * This module is designed to handle common encoding tasks in a web application context.
 * It includes methods for encoding and decoding strings in different formats, ensuring compatibility with various data transmission and storage requirements.
 * It also provides URL-safe encoding methods and HTML entity encoding to prevent XSS attacks.
 */

/**
 * @namespace base64
 * @memberof module:encode
 * @description Provides methods for Base64 encoding and decoding.
 * This namespace includes functions to encode and decode strings in Base64 format, which is commonly used for data transmission in web applications.
 * It supports both standard Base64 and URL-safe Base64 encoding.
 */
const base64 = {
    /**
     * @function encode
     * @memberof module:encode.base64
     * @description Encodes a UTF-8 string into a Base64 string.
     * @param {string} inputString The string to encode.
     * @returns {string} The Base64 encoded string or null if the input is not a string.
     * @example
     * const encoded = base64.encode('Hello, World!');
     * console.log(encoded); // Outputs: SGVsbG8sIFdvcmxkIQ==
     */
    encode: function (inputString) {
        if (typeof inputString !== 'string') {
            return null; // Or throw an error, depending on desired strictness
        }

        return Buffer.from(inputString, 'utf8').toString('base64');
    },

    /**
     * @function decode
     * @memberof module:encode.base64
     * @description Decodes a Base64 string back into a UTF-8 string.
     * @param {string} base64String The Base64 string to decode.
     * @returns {string} The original UTF-8 string or null if the input is not a string.
     * @example
     * const decoded = base64.decode('SGVsbG8sIFdvcmxkIQ==');
     * console.log(decoded); // Outputs: Hello, World!
     */
    decode: function (base64String) {
        if (typeof base64String !== 'string') {
            return null;
        }

        return Buffer.from(base64String, 'base64').toString('utf8');
    },

    /**
     * @function encodeUrl
     * @memberof module:encode.base64
     * @description Encodes a string using the URL-safe Base64 variant.
     * This replaces '+' with '-', '/' with '_', and removes padding ('=').
     * It is useful for encoding data that will be included in URLs or HTTP headers.
    * @param {string} input The string or buffer to encode.
    * @returns {string} The Base64Url encoded string.
    * @example
    * const encodedUrl = base64.encodeUrl('Hello, World!');
    * console.log(encodedUrl); // Outputs: SGVsbG8sIFdvcmxkIQ==
    */
    encodeUrl: function (input) {
        // Replace + with - and Replace / with _ and remove padding
        return Buffer.from(input).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');
    },

    /**
     * * @function decodeUrl
     * @memberof module:encode.base64
     * @description Decodes a Base64Url encoded string.
     * This reverses the URL-safe encoding by replacing '-' with '+', '_' with '/', and adding padding if necessary.
     * It is useful for decoding data that was encoded for use in URLs or HTTP headers.
    * @param {string} input The Base64Url string.
    * @returns {string} The decoded string.
    * @example
    * const decodedUrl = base64.decodeUrl('SGVsbG8sIFdvcmxkIQ');
    * console.log(decodedUrl); // Outputs: Hello, World!
    */
    decodeUrl: function (input) {
        // Add back the padding that was removed.
        input = input.replace(/-/g, '+').replace(/_/g, '/');
        const padding = input.length % 4;
        if (padding) {
            input += '='.repeat(4 - padding);
        }
        return Buffer.from(input, 'base64').toString('utf8');
    }
};

/**
 * @namespace uri
 * @memberof module:encode
 * @description Provides methods for URI encoding and decoding.
 * This namespace includes functions to safely encode and decode strings for use in URIs, ensuring that special characters are properly handled.
 * It is useful for preparing data to be included in URLs, query parameters, or path segments
 */
const uri = {
    /**
     * @function encode
     * @memberof module:encode.uri
     * @description Encodes a string for use in a URI.
     * @param {string} inputString The string to encode.
     * @returns {string} The encoded URI component.
     * @example
     * const encoded = uri.encode('Hello, World!');
     * console.log(encoded); // Outputs: Hello%2C%20World%21
     */
    encode: function (inputString) {
        if (typeof inputString !== 'string') {
            return ''; // Or throw an error, depending on desired strictness
        }

        return encodeURIComponent(inputString);
    },

    /**
     * @function decode
     * @memberof module:encode.uri
     * @description Decodes a URI-encoded string.
     * @param {string} encodedString The encoded string to decode.
     * @returns {string} The decoded string.
     * @example
     * const decoded = uri.decode('Hello%2C%20World%21');
     * console.log(decoded); // Outputs: Hello, World!
     */
    decode: function (encodedString) {
        if (typeof encodedString !== 'string') {
            return '';
        }

        return decodeURIComponent(encodedString);
    }
};

/**
 * @namespace hex
 * @memberof module:encode
 * @description Provides methods for hexadecimal encoding and decoding.
 * This namespace includes functions to convert strings to and from hexadecimal format, which is often used for data representation in computing.
 * It is useful for encoding binary data as a readable string format, commonly used in cryptography and data transmission.
 */
const hex = {
    /**
     * @function encode
     * @memberof module:encode.hex
     * @description Encodes a string into hexadecimal format.
     * @param {string} inputString The string to encode.
     * @returns {string} The hexadecimal encoded string.
     * @example
     * const encoded = hex.encode('Hello, World!');
     * console.log(encoded); // Outputs: 48656c6c6f2c20576f726c6421
     */
    encode: function (inputString) {
        if (typeof inputString !== 'string') {
            return '';
        }

        return Buffer.from(inputString, 'utf8').toString('hex');
    },

    /**
     * @function decode
     * @memberof module:encode.hex
     * @description Decodes a hexadecimal string back into a UTF-8 string.
     * @param {string} hexString The hexadecimal string to decode.
     * @returns {string} The original UTF-8 string.
     * @example
     * const decoded = hex.decode('48656c6c6f2c20576f726c6421');
     * console.log(decoded); // Outputs: Hello, World!
     */
    decode: function (hexString) {
        if (typeof hexString !== 'string') {
            return '';
        }

        return Buffer.from(hexString, 'hex').toString('utf8');
    }
};

/**
 * @namespace html
 * @memberof module:encode
 * @description Provides methods for HTML encoding and decoding.
 * This namespace includes functions to safely encode and decode strings for use in HTML contexts, preventing XSS (Cross-Site Scripting) attacks.
 * It is useful for sanitizing user input before displaying it in web pages, ensuring that special characters are properly escaped.
 * It helps to prevent security vulnerabilities by converting characters like `<`, `>`, and `&` into their corresponding HTML entities.
 */
const html = {
    /**
     * @function encode
     * @memberof module:encode.html
     * @description Encodes a string for safe HTML display.
     * @param {string} inputString The string to encode.
     * @returns {string} The HTML encoded string.
     * @example
     * const encoded = html.encode('<script>alert("XSS")</script>');
     * console.log(encoded); // Outputs: &lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;
     */
    encode: function (inputString) {
        if (typeof inputString !== 'string') {
            return '';
        }

        return he.encode(inputString, { useNamedReferences: true });
    },

    /**
     * @function decode
     * @memberof module:encode.html
     * @description Decodes an HTML encoded string back to its original form.
     * @param {string} encodedString The HTML encoded string to decode.
     * @returns {string} The decoded string.
     * @example
     * const decoded = html.decode('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');
     * console.log(decoded); // Outputs: <script>alert("XSS")</script>
     */
    decode: function (encodedString) {
        if (typeof encodedString !== 'string') {
            return '';
        }

        return he.decode(encodedString);
    }
};

/**
 * @namespace base58
 * @memberof module:encode
 * @description Provides methods for Base58 encoding and decoding.
 * This namespace includes functions to encode and decode strings in Base58 format, which is commonly used for data representation in applications like Bitcoin addresses.
 */
const base58 = {
    /**
     * @function encode
     * @memberof module:encode.base58
     * @description Encodes a Buffer or string into Base58 format.
     * @param {Buffer|string} inputBuffer The data to encode.
     * @returns {string} The Base58 encoded string.
     * @example
     * const encoded = base58.encode(Buffer.from('Hello, World!'));
     * console.log(encoded); // Outputs: 2NEpo7TZRRrLZSi2U
     */
    encode: function (inputBuffer) {
        return bs58.encode(inputBuffer);
    },

    /**
     * @function decode
     * @memberof module:encode.base58
     * @description Decodes a Base58 encoded string back into a Buffer.
     * @param {string} base58String The Base58 string to decode.
     * @returns {Buffer} The decoded Buffer.
     * @example
     * const decoded = base58.decode('2NEpo7TZRRrLZSi2U');
     * console.log(decoded.toString()); // Outputs: Hello, World!
     */
    decode: function (base58String) {
        return bs58.decode(base58String);
    }
};

module.exports = {
    base64,
    uri,
    hex,
    html,
    base58
};
