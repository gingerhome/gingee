const { als } = require('../../modules/ginger');
const auth = require('../../modules/auth');

// We mock the dependencies of the auth module
jest.mock('../../modules/crypto');
jest.mock('../../modules/encode');
const crypto = require('../../modules/crypto');
const encode = require('../../modules/encode');

describe('auth.js - JWT Functionality', () => {
    
    const mockPayload = { userId: 42, role: 'user' };
    const mockSecret = 'test-jwt-secret';
    let mockAlsStore;

    beforeEach(() => {
        jest.clearAllMocks();
        mockAlsStore = {
            app: { config: { jwt_secret: mockSecret } },
            logger: { error: jest.fn() } // For verifyToken error logging
        };
    });

    test('createToken should generate a 3-part JWT string', () => {
        // Mock the dependencies to return predictable values
        encode.base64.encodeUrl.mockImplementation(input => {
            // Check the type of the input and convert to string if needed.
            const str = Buffer.isBuffer(input) ? input.toString() : String(input);
            return `encoded_${str.substring(0, 10)}`;
        });
        crypto.hmacSha256Encrypt.mockReturnValue('fake_signature_hex');
        
        als.run(mockAlsStore, () => {
            const token = auth.jwt.create(mockPayload, '1h');
            expect(typeof token).toBe('string');
            expect(token.split('.').length).toBe(3);
        });
    });

    test('verifyToken should return payload for a valid token', () => {
        const realCrypto = jest.requireActual('../../modules/crypto');
        const realEncode = jest.requireActual('../../modules/encode');
        
        crypto.hmacSha256Encrypt.mockImplementation(realCrypto.hmacSha256Encrypt);
        encode.base64.encodeUrl.mockImplementation(realEncode.base64.encodeUrl);
        encode.base64.decodeUrl.mockImplementation(realEncode.base64.decodeUrl);
        
        als.run(mockAlsStore, () => {
            // 1. Create a real token using the function we want to test.
            const token = auth.jwt.create(mockPayload, '1h');
            
            // 2. Verify that same token.
            const verifiedPayload = auth.jwt.verify(token);

            // 3. Assertions
            expect(verifiedPayload).not.toBeNull();
            expect(verifiedPayload.userId).toBe(mockPayload.userId);
            expect(verifiedPayload.role).toBe(mockPayload.role);
            expect(verifiedPayload.exp).toBeDefined();
        });
    });

    test('verifyToken should return null for an expired token', () => {
        jest.useFakeTimers().setSystemTime(new Date('2023-01-01T12:00:00Z'));
        
        // We also need the real implementations here to create a valid token
        const realCrypto = jest.requireActual('../../modules/crypto');
        const realEncode = jest.requireActual('../../modules/encode');
        crypto.hmacSha256Encrypt.mockImplementation(realCrypto.hmacSha256Encrypt);
        encode.base64.encodeUrl.mockImplementation(realEncode.base64.encodeUrl);

        let expiredToken;
        als.run(mockAlsStore, () => {
            expiredToken = auth.jwt.create(mockPayload, '1h');
        });

        // Advance time by 2 hours
        jest.advanceTimersByTime(2 * 60 * 60 * 1000);

        als.run(mockAlsStore, () => {
            const result = auth.jwt.verify(expiredToken);
            expect(result).toBeNull();
        });

        jest.useRealTimers();
    });
});
