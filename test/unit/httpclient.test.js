const httpclient = require('../../modules/httpclient');
jest.mock('axios');
const axios = require('axios');

describe('httpclient.js - HTTP Client', () => {

    test('get should request an arraybuffer and return a string for text content', async () => {
        const mockHtml = '<html><body>Hello</body></html>';
        axios.get.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'text/html' },
            data: Buffer.from(mockHtml)
        });

        const result = await httpclient.get('http://example.com');

        expect(axios.get).toHaveBeenCalledWith('http://example.com', expect.objectContaining({
            responseType: 'arraybuffer'
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
                responseType: 'arraybuffer'
            })
        );
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
