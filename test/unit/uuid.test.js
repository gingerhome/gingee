const { v4, validate } = require('../../modules/uuid');

describe('uuid.js - UUID Utilities', () => {
    test('v4 should generate a valid v4 UUID', () => {
        const id = v4();
        // A simple regex to check the format
        const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(id).toMatch(uuidV4Regex);
    });

    test('validate should correctly identify valid and invalid UUIDs', () => {
        const validId = v4();
        expect(validate(validId)).toBe(true);
        expect(validate('not-a-uuid')).toBe(false);
        expect(validate('e8b6b3e4-0b1f-4b9e-8b1a-8c1c1c1c1c1g')).toBe(false); // 'g' is invalid
    });
});