module.exports = async function () {
  gingee(async ($g) => {
    const cacheService = require("cache_service");
    const sessionCookie = require("./session_cookie.js");
    const csrf = require("./csrf.js");

    try {
      const sessionId = $g.request.cookies.sessionId;
      if (sessionId) {
        await cacheService.del(`session:${sessionId}`);
      }

      // Clear cookies with the same Path (/glade) and Secure flag as login so the browser removes them.
      $g.response.cookies.sessionId = sessionCookie.clearSessionCookie(
        $g.request,
      );
      $g.response.cookies[csrf.CSRF_COOKIE_NAME] = csrf.clearCsrfCookie(
        $g.request,
      );

      $g.response.send({
        status: "success",
        message: "Logged out successfully.",
      });
    } catch (err) {
      $g.log.error("Error during logout:", { error: err.message });
      $g.response.send({ error: "Logout failed." }, 500);
    }
  });
};
