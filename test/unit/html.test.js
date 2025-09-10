const { als } = require('../../modules/gingee');
const html = require('../../modules/html');

// Mock the dependencies of the html module
jest.mock('cheerio');
jest.mock('../../modules/fs');
jest.mock('../../modules/httpclient');

const cheerio = require('cheerio');
const fs = require('../../modules/fs');
const httpclient = require('../../modules/httpclient');

describe('html.js - HTML Parsing Module', () => {

    beforeEach(() => {
        jest.clearAllMocks();
        // Mock the return of cheerio.load to be a simple function
        cheerio.load.mockReturnValue(jest.fn());
    });

    test('fromString should load the provided string into cheerio', () => {
        const htmlString = '<h1>Hello</h1>';
        html.fromString(htmlString);
        expect(cheerio.load).toHaveBeenCalledWith(htmlString);
    });

    test('fromFileSync should use the secure fs module to read a file', () => {
        const mockContent = '<h1>From File</h1>';
        // Configure the fs mock to return our content
        fs.readFileSync.mockReturnValue(mockContent);
        
        // This test doesn't need a full ALS context because we are mocking the fs module
        // which is the only part that uses it.
        html.fromFileSync(fs.BOX, './page.html');
        
        // Verify our secure fs was called
        expect(fs.readFileSync).toHaveBeenCalledWith(fs.BOX, './page.html', 'utf8');
        // Verify the content was passed to cheerio
        expect(cheerio.load).toHaveBeenCalledWith(mockContent);
    });

    test('fromUrl should use the httpclient and validate the content type', async () => {
        const mockHtmlContent = '<h1>From URL</h1>';
        // Configure the httpclient mock
        httpclient.get.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'text/html; charset=utf-8' },
            body: mockHtmlContent
        });
        
        await html.fromUrl('http://example.com');
        
        // Verify httpclient was called
        expect(httpclient.get).toHaveBeenCalledWith('http://example.com', {});
        // Verify the body was passed to cheerio
        expect(cheerio.load).toHaveBeenCalledWith(mockHtmlContent);
    });
    
    test('fromUrl should throw an error for non-html content types', async () => {
        httpclient.get.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: '{ "message": "not html" }'
        });
        
        // We expect this async function to reject
        await expect(
            html.fromUrl('http://example.com/api')
        ).rejects.toThrow("Invalid content type. Expected 'text/html' but received 'application/json'.");
        
        // Verify cheerio.load was NOT called
        expect(cheerio.load).not.toHaveBeenCalled();
    });

    test('fromUrl should pass options through to the httpclient', async () => {
        const mockHtmlContent = '<h1>Authed Page</h1>';
        httpclient.get.mockResolvedValue({
            status: 200,
            headers: { 'content-type': 'text/html' },
            body: mockHtmlContent
        });

        const requestOptions = {
            headers: { 'Authorization': 'Bearer 123' }
        };

        await html.fromUrl('http://example.com/private', requestOptions);
        
        // Verify that httpclient was called with the options object
        expect(httpclient.get).toHaveBeenCalledWith('http://example.com/private', requestOptions);
    });
});
