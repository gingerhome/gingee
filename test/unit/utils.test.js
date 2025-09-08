const { string, validate } = require('../../modules/utils');

describe('utils.js - string utilities', () => {
    test('capitalize should uppercase the first letter', () => {
        expect(string.capitalize('hello')).toBe('Hello');
    });

    test('slugify should create a URL-friendly slug', () => {
        expect(string.slugify(' This is a -- Test! ')).toBe('this-is-a-test');
    });
});

describe('utils.js - validate utilities', () => {
    test('isEmail should validate email formats correctly', () => {
        expect(validate.isEmail('test@example.com')).toBe(true);
        expect(validate.isEmail('not-an-email')).toBe(false);
    });

    test('hasLength should validate string length', () => {
        expect(validate.hasLength('abc', { exact: 3 })).toBe(true);
        expect(validate.hasLength('password', { min: 8 })).toBe(true);
        expect(validate.hasLength('toolong', { max: 5 })).toBe(false);
    });
});