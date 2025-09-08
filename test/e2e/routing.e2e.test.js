const axios = require('axios');
const { startServer, stopServer } = require('./test_server.helper');

describe('Routing (End-to-End Tests)', () => {
    // Start the server before any tests in this file run
    beforeAll(async () => {
        await startServer();
    });

    // Stop the server after all tests in this file have run
    afterAll(async () => {
        await stopServer();
    });

    test('should serve a static file from the glade app', async () => {
        const response = await axios.get('http://localhost:7070/glade/login.html');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/html');
        expect(response.data).toContain('<title>Login - Glade Admin</title>');
    });

    test('should execute a file-based server script and return JSON', async () => {
        // This assumes a 'tests' app with a 'simple.js' script exists
        const response = await axios.get('http://localhost:7070/tests/simple');
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/plain');
        expect(response.data).toBe('Hello, World!');
    });

    test('should handle manifest-based routing with path parameters', async () => {
        // This assumes a 'routing_test' app with routes.json is set up
        const response = await axios.get('http://localhost:7070/tests/users/42');
        expect(response.status).toBe(200);
        expect(response.data.message).toBe('DYNAMIC ROUTE TEST: Details for user ID: 42');
    });
});
