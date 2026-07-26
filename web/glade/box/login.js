module.exports = async function () {
  gingee(async ($g) => {
    const crypto = require('crypto');
    const cacheService = require('cache_service');
    const sessionCookie = require('./session_cookie.js');

    try {
      const { username, password } = $g.request.body;
      const { ADMIN_USERNAME, ADMIN_PASSWORD_HASH } = $g.app.env;

      if (!username || !password) {
        return $g.response.send({ code: 400, message: 'Username and password are required.' }, 400);
      }

      // 1. Verify username
      if (username !== ADMIN_USERNAME) {
        return $g.response.send({ code: 401, message: 'Invalid credentials.' }, 401);
      }

      // 2. Verify password hash
      const isPasswordCorrect = await crypto.verifyPassword(password, ADMIN_PASSWORD_HASH);
      if (!isPasswordCorrect) {
        return $g.response.send({ code: 401, message: 'Invalid credentials.' }, 401);
      }

      // 3. Create a session
      const sessionId = crypto.generateSecureRandomString(32);
      const sessionData = {
        user: username,
        loggedInAt: new Date().toISOString()
      };
      // Session expires in 8 hours (28800 seconds) — keep cache TTL and Max-Age aligned
      await cacheService.set(
        `session:${sessionId}`,
        sessionData,
        sessionCookie.SESSION_MAX_AGE_SEC
      );

      // 4. Set the session cookie (Path=/glade; Secure when HTTPS)
      $g.response.cookies.sessionId = sessionCookie.setSessionCookie(sessionId, $g.request);

      $g.response.send({ code: 200, status: 'success' });
    } catch (err) {
      $g.log.error('Login error:', { error: err.message });
      $g.response.send({ code: 500, message: 'An internal error occurred.' }, 500);
    }
  });
};
