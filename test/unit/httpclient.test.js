const httpclient = require('../../modules/httpclient');
const egress = require('../../modules/egress');
jest.mock('axios');
const axios = require('axios');

describe('httpclient.js - HTTP Client', () => {
    beforeEach(() => {
        egress._resetForTests();
        // Tests use public hostnames; disable DNS check for speed/determinism.
        egress.initServer({ mode: 'protected', dns_check: false }, { info: jest.fn(), warn: jest.fn() });
        jest.clearAllMocks();
    });

    afterEach(() => {
        egress._resetForTests();
    });

    test('get should request an arraybuffer and return a string for text content', async () => {
        const mockHtml = '<html><body>Hello</body></html>';
        axios.get.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'text/html' },
            data: Buffer.from(mockHtml)
        });

        const result = await httpclient.get('http://example.com');

        expect(axios.get).toHaveBeenCalledWith('http://example.com', expect.objectContaining({
            responseType: 'arraybuffer',
            timeout: expect.any(Number)
        }));
        expect(result.body).toBe(mockHtml);
    });

    test('get should request an arraybuffer and return a Buffer for binary content', async () => {
        const mockImageBuffer = Buffer.from([1, 2, 3, 4]);
        axios.get.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'image/png' },
            data: mockImageBuffer
        });

        const result = await httpclient.get('http://example.com/image.png');

        expect(result.body).toBeInstanceOf(Buffer);
        expect(result.body.equals(mockImageBuffer)).toBe(true);
    });

    test('post should stringify a JSON body and set the correct content type', async () => {
        const postData = { user: 'test', id: 42 };

        // Mock the response
        axios.post.mockResolvedValue({
            status: 201,
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({ success: true }))
        });

        await httpclient.post('http://example.com/api/users', postData, {
            postType: httpclient.JSON // Use the exported constant
        });

        // Verify axios.post was called with the correct arguments
        expect(axios.post).toHaveBeenCalledWith(
            'http://example.com/api/users',
            JSON.stringify(postData), // 1. Verify body was stringified
            expect.objectContaining({
                headers: { 'Content-Type': 'application/json' }, // 2. Verify header was set
                responseType: 'arraybuffer',
                timeout: expect.any(Number)
            })
        );
    });

    test('get applies default timeout and returns 504 on axios timeout', async () => {
        const err = new Error('timeout of 15000ms exceeded');
        err.code = 'ECONNABORTED';
        axios.get.mockRejectedValue(err);

        const result = await httpclient.get('http://example.com/slow');
        expect(result.status).toBe(504);
        expect(result.code).toBe('ETIMEDOUT');
        expect(String(result.body)).toMatch(/timed out/i);
    });

    test('get denies private IP with EGRESS_DENIED without calling axios', async () => {
        const result = await httpclient.get('http://127.0.0.1:9/');
        expect(result.status).toBe(403);
        expect(result.code).toBe('EGRESS_DENIED');
        expect(axios.get).not.toHaveBeenCalled();
    });

    test('post should correctly format a FORM url-encoded body', async () => {
        const postData = { user: 'test', token: 'abc 123' };

        axios.post.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'application/json' },
            data: Buffer.from(JSON.stringify({ success: true }))
        });

        await httpclient.post('http://example.com/login', postData, {
            postType: httpclient.FORM
        });

        // querystring.stringify encodes spaces as '+'
        const expectedBody = 'user=test&token=abc%20123';

        expect(axios.post).toHaveBeenCalledWith(
            'http://example.com/login',
            expectedBody, // Verify body was correctly url-encoded
            expect.objectContaining({
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            })
        );
    });
});
