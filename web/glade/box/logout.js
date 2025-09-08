module.exports = async function() {
    ginger(async ($g) => {
        const cacheService = require('cache_service');

        try {
            const sessionId = $g.request.cookies.sessionId;
            if (sessionId) {
                await cacheService.del(`session:${sessionId}`);
            }

            // Also clear the cookie on the browser by setting an expired one.
            // This is a good practice for immediate logout.
            $g.response.cookies.sessionId = 'loggedout; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT';
            
            $g.response.send({ status: 'success', message: 'Logged out successfully.' });
        } catch(err) {
            $g.log.error('Error during logout:', { error: err.message });
            $g.response.send({ error: 'Logout failed.' }, 500);
        }
    });
};