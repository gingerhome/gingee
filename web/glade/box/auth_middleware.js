module.exports = async function() {
    // IMPORTANT: if the include script is a middleware and requires sequential execution prior to further scripts, 
    // it should await on the gingee function as done below
    await gingee(async ($g) => {
        const cacheService = require('cache_service');
        const { request, response, log } = $g;

        const sessionId = request.cookies.sessionId;
        let isSessionValid = false;

        if (sessionId) {
            const sessionData = await cacheService.get(`session:${sessionId}`);
            if (sessionData) {
                isSessionValid = true;
                // Attach user $g for later scripts
                $g.user = sessionData.user;
            }
        }

        const isLoginPage = request.path.startsWith('/glade/login.html');
        const isLoginApiRequest = request.path === '/glade/login';

        if (isSessionValid) {
            if (isLoginPage || isLoginApiRequest) {
                // User is logged in but trying to access login page. Redirect to dashboard.
                log.info('Authenticated user accessing login page. Redirecting to dashboard.');
                response.headers['Location'] = '/glade/index.html';
                response.send(null, 302); // This sets isCompleted = true
            }
            // If session is valid and not the login page, we do nothing.
            // The middleware finishes, and the main handler will be allowed to run.
        } else {
            // Session is NOT valid.
            const isPublicAsset = request.path.startsWith('/glade/css/') || request.path.startsWith('/glade/scripts/') || request.path.startsWith('/glade/images/');

            if (isLoginPage || isLoginApiRequest || isPublicAsset) {
                // Allow access to the login page and its necessary assets.
            } else {
                // Block access to all other pages/APIs.
                log.warn(`Unauthenticated access attempt blocked for: ${request.path}`);
                if (request.path.startsWith('/glade/api/')) {
                    // For API requests, send a 401 Unauthorized error.
                    response.send({ error: 'Unauthorized' }, 401);
                } else {
                    // For UI pages, redirect to the login page.
                    response.headers['Location'] = '/glade/login.html';
                    response.send(null, 302);
                }
            }
        }
    });
};
