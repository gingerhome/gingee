/**
 * @module utils
 * @description A collection of utility functions for various tasks.
 * This module provides functions for generating random data, validating inputs, manipulating strings, and more.
 * It abstracts common tasks into reusable functions, making it easier to write clean and maintainable code.
 * It is particularly useful for tasks that require randomization, validation, or string manipulation.
 */


/**
 * @namespace rnd
 * @memberof module:utils
 * @description A util lib for generating various types of random data.
 * It provides functions to generate random integers, floats, booleans, colors, and strings
 * Uses Math.random(), so it is NOT cryptographically secure.
 * For security-sensitive randomness, use the 'crypto' module.
 */
const rnd = {
    /**
     * @function int
     * @memberof module:utils.rnd
     * @description Generates a random integer from 0 up to (but not including) max.
     * @param {number} max - The upper bound (exclusive).
     * @returns {number} A random integer.
     * @example
     * const randomInt = rnd.int(10); // Returns a random integer between 0 and 9
     * console.log(randomInt); // Outputs a random integer
     * @throws {Error} If max is not a positive number.
     */
    int(max = 1) {
        if (max <= 0) throw new Error('Max must be a positive number.');
        return Math.floor(Math.random() * max);
    },

    /**
     * @function float
     * @memberof module:utils.rnd
     * @description Generates a random float from 0 up to (but not including) max.
     * @param {number} max - The upper bound (exclusive).
     * @returns {number} A random float.
     * @example
     * const randomFloat = rnd.float(10); // Returns a random float between 0 and 10
     * console.log(randomFloat); // Outputs a random float
     * @throws {Error} If max is not a positive number.
     */
    float(max = 1) {
        if (max <= 0) throw new Error('Max must be a positive number.');
        return Math.random() * max;
    },

    /**
     * @function intInRange
     * @memberof module:utils.rnd
     * @description Generates a random integer within a given range (inclusive).
     * @param {number} min - The minimum value of the range.
     * @param {number} max - The maximum value of the range.
     * @returns {number} A random integer.
     * @example
     * const randomInt = rnd.intInRange(1, 10); // Returns a random integer between 1 and 10
     * console.log(randomInt); // Outputs a random integer
     * @throws {Error} If min is greater than max.
     */
    intInRange(min, max) {
        if (min > max) throw new Error('Min must be less than or equal to max.');
        min = Math.ceil(min);
        max = Math.floor(max);
        return Math.floor(Math.random() * (max - min + 1)) + min;
    },

    /**
     * @function floatInRange
     * @memberof module:utils.rnd
     * @description Generates a random float within a given range.
     * @param {number} min - The minimum value of the range.
     * @param {number} max - The maximum value of the range.
     * @returns {number} A random float.
     * @example
     * const randomFloat = rnd.floatInRange(1.5, 5.5); // Returns a random float between 1.5 and 5.5
     * console.log(randomFloat); // Outputs a random float
     * @throws {Error} If min is greater than max.
     */
    floatInRange(min, max) {
        if (min > max) throw new Error('Min must be less than or equal to max.');
        return Math.random() * (max - min) + min;
    },

    /**
     * @function bool
     * @memberof module:utils.rnd
     * @description Returns a random boolean (true or false).
     * @returns {boolean}
     * @example
     * const randomBool = rnd.bool(); // Returns either true or false
     * console.log(randomBool); // Outputs a random boolean
     */
    bool() {
        return Math.random() < 0.5;
    },

    /**
     * @function choice
     * @memberof module:utils.rnd
     * @description Selects a random element from an array.
     * @param {Array<any>} array - The array to choose from.
     * @returns {any|undefined} A random element from the array, or undefined if the array is empty.
     * @example
     * const randomChoice = rnd.choice([1, 2, 3, 4, 5]); // Returns a random element from the array
     * console.log(randomChoice); // Outputs a random element from the array
     * @example
     * const randomChoice = rnd.choice([]); // Returns undefined
     */
    choice(array) {
        if (!Array.isArray(array) || array.length === 0) return undefined;
        const randomIndex = Math.floor(Math.random() * array.length);
        return array[randomIndex];
    },

    /**
     * @function shuffle
     * @memberof module:utils.rnd
     * @description Shuffles an array in place using the Fisher-Yates algorithm and returns it.
     * @param {Array<any>} array - The array to shuffle.
     * @returns {Array<any>} The shuffled array.
     * @example
     * const shuffledArray = rnd.shuffle([1, 2, 3, 4, 5]); // Returns a shuffled version of the array
     * console.log(shuffledArray); // Outputs the shuffled array
     */
    shuffle(array) {
        let currentIndex = array.length;
        let randomIndex;
        // While there remain elements to shuffle.
        while (currentIndex !== 0) {
            // Pick a remaining element.
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex--;
            // And swap it with the current element.
            [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
        }
        return array;
    },

    /**
     * @function color
     * @memberof module:utils.rnd
     * @description Generates a random hex color code.
     * @returns {string} A random hex color string (e.g., '#a4c1e8').
     * @example
     * const randomColor = rnd.color(); // Returns a random hex color code
     * console.log(randomColor); // Outputs a random hex color code
     */
    color() {
        // Generate a random 24-bit integer, then convert to a 6-digit hex string.
        const randomColor = Math.floor(Math.random() * 16777215).toString(16);
        // Pad with leading zeros if necessary
        return '#' + randomColor.padStart(6, '0');
    },

    /**
     * @function string
     * @memberof module:utils.rnd
     * @description Generates a random string of a given length using only alphabetic characters.
     * NOT cryptographically secure. For secure random strings, use the 'crypto' module.
     * @param {number} length - The desired length of the string.
     * @returns {string} A random string of letters.
     * @example
     * const randomString = rnd.string(10); // Returns a random string of 10 characters
     * console.log(randomString); // Outputs a random string of letters
     */
    string(length = 8) {
        const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }
};

// --- STRING UTILITIES ---
/**
 * @namespace string
 * @memberof module:utils
 * @description A collection of string manipulation utilities.
 * Provides functions for string formatting, slugification, truncation, and HTML stripping.
 * These functions are useful for preparing strings for display, storage, or further processing.
 * They help ensure strings are in a consistent format, making them easier to work with in applications
 */
const string = {
    /**
     * @function capitalize
     * @memberof module:utils.string
     * @description Converts the first character of a string to uppercase.
     * @param {string} str The input string.
     * @returns {string} or empty string if input is not a string.
     * @example
     * const capitalized = string.capitalize('hello world');
     * console.log(capitalized); // Outputs: Hello world
     */
    capitalize(str = '') {
        if (typeof str !== 'string' || str.length === 0) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    },

    /**
     * @function slugify
     * @memberof module:utils.string
     * @description Converts a string into a URL-friendly "slug".
     * @param {string} str The input string.
     * @returns {string} or empty string if input is not a string.
     * @example
     * const slug = string.slugify('Hello World! This is a test.');
     * console.log(slug); // Outputs: hello-world-this-is-a-test
     */
    slugify(str = '') {
        if (typeof str !== 'string') return '';
        return str
            .toString()
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')           // Replace spaces with -
            .replace(/[^\w\-]+/g, '')       // Remove all non-word chars
            .replace(/\-\-+/g, '-')         // Replace multiple - with single -
            .replace(/^-+/, '')             // Trim - from start of text
            .replace(/-+$/, '');            // Trim - from end of text
    },

    /**
     * @function truncate
     * @memberof module:utils.string
     * @description Truncates a string to a maximum length without cutting words in half.
     * @param {string} str The input string.
     * @param {number} length The maximum length.
     * @param {string} [suffix='...'] The suffix to append if truncated.
     * @returns {string} or empty string if input is not a string.
     * @example
     * const truncated = string.truncate('This is a long string that needs to be truncated.', 30);
     * console.log(truncated); // Outputs: This is a long string that...
     */
    truncate(str = '', length, suffix = '...') {
        if (typeof str !== 'string' || str.length <= length) {
            return str;
        }

        // Find the last space within the allowed length.
        // We use slice to get the substring to search within.
        const subString = str.slice(0, length - suffix.length);
        const lastSpaceIndex = subString.lastIndexOf(' ');

        // If a space is found, truncate the string up to that point.
        // Otherwise (if the first word is too long), truncate at the character limit.
        const cutOffIndex = lastSpaceIndex > 0 ? lastSpaceIndex : length - suffix.length;

        // Use slice again to get the final truncated string.
        const truncated = str.slice(0, cutOffIndex);

        return truncated + suffix;
    },

    /**
     * @function stripHtml
     * @memberof module:utils.string
     * @description Removes all HTML tags from a string.
     * @param {string} htmlString The input string containing HTML.
     * @returns {string} or empty string if input is not a string.
     * @example
     * const cleanString = string.stripHtml('<p>This is <strong>bold</strong> text.</p>');
     * console.log(cleanString); // Outputs: This is bold text.
     */
    stripHtml(htmlString = '') {
        if (typeof htmlString !== 'string') return '';
        return htmlString.replace(/<[^>]*>?/gm, '');
    }
};


// --- VALIDATION UTILITIES ---
/**
 * @namespace validate
 * @member
 * @description A collection of validation utilities for common data types.
 * Provides functions to check if a string is a valid email, URL, phone number, and more.
 * These functions help ensure that data conforms to expected formats, making it easier to validate user input.
 */
const validate = {
    /**
     * @function isEmail
     * @memberof module:utils.validate
     * @description Checks if a string is a syntactically valid email address.
     * @param {string} str The input string.
     * @returns {boolean}
     * @example
     * const isValidEmail = validate.isEmail('test@example.com');
     * console.log(isValidEmail); // Outputs: true
     */
    isEmail(str = '') {
        if (typeof str !== 'string') return false;
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(str);
    },

    /**
     * @function isUrl
     * @memberof module:utils.validate
     * @description Checks if a string is a syntactically valid URL.
     * @param {string} str The input string.
     * @returns {boolean}
     * @example
     * const isValidUrl = validate.isUrl('https://example.com');
     * console.log(isValidUrl); // Outputs: true
     */
    isUrl(str = '') {
        try {
            new URL(str);
            return true;
        } catch (_) {
            return false;
        }
    },

    /**
     * @function isEmpty
     * @memberof module:utils.validate
     * @description Checks if a value is null, undefined, an empty string, array, or object.
     * @param {any} value The value to check.
     * @returns {boolean}
     * @example
     * const isEmptyValue = validate.isEmpty('');
     * console.log(isEmptyValue); // Outputs: true
     */
    isEmpty(value) {
        return (
            value === null ||
            value === undefined ||
            (typeof value === 'string' && value.trim().length === 0) ||
            (Array.isArray(value) && value.length === 0) ||
            (typeof value === 'object' && Object.keys(value).length === 0)
        );
    },

    /**
     * @function isPhoneNumber
     * @memberof module:utils.validate
     * @description Checks if a string is a plausible phone number.
     * Allows for digits, spaces, hyphens, parentheses, and an optional leading '+'.
     * @param {string} str The input string.
     * @returns {boolean}
     * @example
     * const isValidPhone = validate.isPhoneNumber('+1 (123) 456-7890');
     * console.log(isValidPhone); // Outputs: true
     */
    isPhoneNumber(str = '') {
        if (typeof str !== 'string') return false;
        // This regex is quite permissive for international formats.
        const phoneRegex = /^[+]?[\d\s\-\(\)]{7,20}$/;
        return phoneRegex.test(str);
    },

    /**
     * @function isInteger
     * @memberof module:utils.validate
     * @description Checks if a value is an integer.
     * @param {any} value The value to check.
     * @returns {boolean}
     * @example
     * const isValidInteger = validate.isInteger(42);
     * console.log(isValidInteger); // Outputs: true
     */
    isInteger(value) {
        return Number.isInteger(value);
    },

    /**
     * @function isInRange
     * @memberof module:utils.validate
     * @description Checks if a number is within a given range (inclusive).
     * @param {number} number The number to check.
     * @param {number} min The minimum boundary.
     * @param {number} max The maximum boundary.
     * @returns {boolean}
     * @example
     * const isInRange = validate.isInRange(5, 1, 10);
     * console.log(isInRange); // Outputs: true
     */
    isInRange(number, min, max) {
        return typeof number === 'number' && number >= min && number <= max;
    },

    /**
     * @function hasLength
     * @memberof module:utils.validate
     * @description Checks if a string's length is within the specified bounds.
     * @param {string} str The string to check.
     * @param {object} options An object with { min, max, exact }.
     * @returns {boolean}
     * @example
     * const isValidLength = validate.hasLength('Hello', { min: 3, max: 10 });
     * console.log(isValidLength); // Outputs: true
     */
    hasLength(str = '', options = {}) {
        if (typeof str !== 'string') return false;
        const { min, max, exact } = options;
        const len = str.length;

        if (exact !== undefined) return len === exact;
        if (min !== undefined && len < min) return false;
        if (max !== undefined && len > max) return false;

        return true;
    },

    /**
     * @function isAlphanumeric
     * @memberof module:utils.validate
     * @description Checks if a string contains only letters and numbers.
     * @param {string} str The string to check.
     * @returns {boolean}
     * @example
     * const isValidAlphanumeric = validate.isAlphanumeric('abc123');
     * console.log(isValidAlphanumeric); // Outputs: true
     */
    isAlphanumeric(str = '') {
        if (typeof str !== 'string') return false;
        const alphanumericRegex = /^[a-zA-Z0-9]+$/;
        return alphanumericRegex.test(str);
    },

    /**
     * @function isInArray
     * @memberof module:utils.validate
     * @description Checks if a value is present in an array of allowed values.
     * @param {any} value The value to check.
     * @param {Array<any>} allowedValues The array of allowed values.
     * @returns {boolean}
     * @example
     * const isValid = validate.isInArray('apple', ['apple', 'banana', 'cherry']);
     * console.log(isValid); // Outputs: true
     */
    isIn(value, allowedValues = []) {
        return allowedValues.includes(value);
    }
};


// --- MISCELLANEOUS UTILITIES ---
/**
 * @namespace misc
 * @memberof module:utils
 * @description A collection of miscellaneous utility functions.
 * Provides functions for clamping numbers, grouping arrays, and other common tasks.
 * These functions help with data manipulation and organization, making it easier to work with collections of data.
 */
const misc = {
    /**
     * @function clamp
     * @memberof module:utils.misc
     * @description Restricts a number to be within a specific range.
     * @param {number} number The number to clamp.
     * @param {number} min The minimum boundary.
     * @param {number} max The maximum boundary.
     * @returns {number}
     * @example
     * const clampedValue = misc.clamp(15, 10, 20);
     * console.log(clampedValue); // Outputs: 15
     * @example
     * const clampedValue = misc.clamp(25, 10, 20);
     * console.log(clampedValue); // Outputs: 20
     */
    clamp(number, min, max) {
        return Math.max(min, Math.min(number, max));
    },

    /**
     * @function groupBy
     * @memberof module:utils.misc
     * @description Groups the elements of an array into an object based on a key or function.
     * @param {Array<object>} array The array to group.
     * @param {string|Function} keyOrFn The key string or a function to determine the group.
     * @returns {object}
     * @example
     * const grouped = misc.groupBy([{ id: 1, category: 'A' }, { id: 2, category: 'B' }, { id: 3, category: 'A' }], 'category');
     * console.log(grouped);
     * // Outputs: { A: [{ id: 1, category: 'A' }, { id: 3, category: 'A' }], B: [{ id: 2, category: 'B' }] }
     * @example
     * const grouped = misc.groupBy([{ id: 1, value: 10 }, { id: 2, value: 20 }, { id: 3, value: 10 }], item => item.value);
     * console.log(grouped);
     * // Outputs: { 10: [{ id: 1, value: 10 }, { id: 3, value: 10 }], 20: [{ id: 2, value: 20 }] }
     */
    groupBy(array, keyOrFn) {
        return array.reduce((result, item) => {
            const key = typeof keyOrFn === 'function' ? keyOrFn(item) : item[keyOrFn];
            (result[key] = result[key] || []).push(item);
            return result;
        }, {});
    }
};

module.exports = {
    rnd,
    string,
    validate,
    misc
};
