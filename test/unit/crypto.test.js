const crypto = require('../../modules/crypto');
const ginger = require('../../modules/ginger'); // Needed for context mocks

// Mock the context for the decrypt error logging
jest.mock('../../modules/ginger');

describe('crypto.js - Cryptography Utilities', () => {

    const testString = 'hello world';
    const testSecret = 'a-very-secret-key';

    test('encrypt/decrypt cycle should return the original text', () => {
        const encrypted = crypto.encrypt(testString, testSecret);
        const decrypted = crypto.decrypt(encrypted, testSecret);
        expect(decrypted).toBe(testString);
    });

    test('decrypt should return null for tampered data', () => {
        const encrypted = crypto.encrypt(testString, testSecret);
        const tampered = encrypted.slice(0, -4) + "beef"; // Change the end of the package
        const decrypted = crypto.decrypt(tampered, testSecret);
        expect(decrypted).toBeNull();
    });
    
    test('decrypt should return null for wrong secret', () => {
        const encrypted = crypto.encrypt(testString, testSecret);
        const decrypted = crypto.decrypt(encrypted, "wrong-secret");
        expect(decrypted).toBeNull();
    });

    test('hmacSha256Verify should correctly validate a signature', () => {
        const signature = crypto.hmacSha256Encrypt(testString, testSecret);
        expect(crypto.hmacSha256Verify(signature, testString, testSecret)).toBe(true);
        expect(crypto.hmacSha256Verify(signature, "wrong string", testSecret)).toBe(false);
    });

    test('hashPassword and verifyPassword cycle should work correctly', async () => {
        const password = 'Password123!';
        const hash = await crypto.hashPassword(password);
        
        expect(typeof hash).toBe('string');
        expect(hash.startsWith('$argon2')).toBe(true);

        const isCorrect = await crypto.verifyPassword(password, hash);
        const isIncorrect = await crypto.verifyPassword('wrongpassword', hash);

        expect(isCorrect).toBe(true);
        expect(isIncorrect).toBe(false);
    });
    
    test('generateSecureRandomString should generate strings of correct length and charset', () => {
        const withNumbers = crypto.generateSecureRandomString(32, false);
        expect(withNumbers.length).toBe(32);
        expect(/^[a-zA-Z0-9]+$/.test(withNumbers)).toBe(true);

        const withoutNumbers = crypto.generateSecureRandomString(32, true);
        expect(withoutNumbers.length).toBe(32);
        expect(/^[a-zA-Z]+$/.test(withoutNumbers)).toBe(true); // Should only contain letters
    });
});
