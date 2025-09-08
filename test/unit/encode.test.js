const { base64, uri, hex, html } = require('../../modules/encode');

describe('encode.js - Utility Tests', () => {

    describe('base64', () => {
        const simpleOriginal = 'Hello GingerJS!';
        const simpleEncoded = 'SGVsbG8gR2luZ2VySlMh';

        const urlUnsafeOriginal = 'a+b/c==?';
        const urlUnsafeEncoded_Std = 'YStiL2M9PT8='; // Standard base64
        const urlUnsafeEncoded_Url = 'YStiL2M9PT8'; // URL-safe variant

        test('encode should produce standard Base64', () => {
            expect(base64.encode(simpleOriginal)).toBe(simpleEncoded);
            expect(base64.encode(urlUnsafeOriginal)).toBe(urlUnsafeEncoded_Std);
        });

        test('decode should decode standard Base64', () => {
            expect(base64.decode(simpleEncoded)).toBe(simpleOriginal);
            expect(base64.decode(urlUnsafeEncoded_Std)).toBe(urlUnsafeOriginal);
        });

        // --- THIS IS THE CORRECTED TEST ---
        test('encodeUrl should produce URL-safe Base64', () => {
            // It should replace '+' with '-', '/' with '_', and remove '=' padding.
            const input = 'a+b/c?'; // A string with unsafe characters
            const expected = 'YStiL2M_'; // The correct URL-safe encoding
            expect(base64.encodeUrl(input)).toBe(expected);
        });

        test('decodeUrl should decode URL-safe Base64', () => {
            const input = 'YStiL2M_';
            const expected = 'a+b/c?';
            expect(base64.decodeUrl(input)).toBe(expected);
        });
    });

    describe('uri', () => {
        const original = 'a query with spaces & symbols?';
        const encoded = 'a%20query%20with%20spaces%20%26%20symbols%3F';

        test('should encode URI components', () => {
            expect(uri.encode(original)).toBe(encoded);
        });
        test('should decode URI components', () => {
            expect(uri.decode(encoded)).toBe(original);
        });
    });

    describe('html', () => {
        const original = '<p class="test">"Inject\'d" & an <script>alert(1)</script></p>';
        const encoded = '&lt;p class=&quot;test&quot;&gt;&quot;Inject&apos;d&quot; &amp; an &lt;script&gt;alert(1)&lt;/script&gt;&lt;/p&gt;';

        test('should encode HTML entities', () => {
            expect(html.encode(original)).toBe(encoded);
        });
        test('should decode HTML entities', () => {
            expect(html.decode(encoded)).toBe(original);
        });
    });
});
