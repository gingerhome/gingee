module.exports = async function () {
  // IMPORTANT: if the include script is a middleware and requires sequential execution prior to further scripts,
  // it should await on the gingee function as done below
  await gingee(async ($g) => {
    const cacheService = require("cache_service");
    const crypto = require("crypto");
    const sessionCookie = require("./session_cookie.js");
    const csrf = require("./csrf.js");
    const { request, response, log } = $g;

    const sessionId = request.cookies.sessionId;
    let isSessionValid = false;
    /** @type {object|null} */
    let sessionData = null;
    let sessionCacheKey = null;

    if (sessionId) {
      sessionCacheKey = `session:${sessionId}`;
      sessionData = await cacheService.get(sessionCacheKey);
      if (sessionData) {
        isSessionValid = true;
        // Attach user $g for later scripts
        $g.user = sessionData.user;

        // Ensure session has a CSRF token (upgrade path for sessions created before H9).
        if (!sessionData.csrfToken) {
          sessionData.csrfToken = csrf.createCsrfToken(crypto);
          await cacheService.set(
            sessionCacheKey,
            sessionData,
            sessionCookie.SESSION_MAX_AGE_SEC,
          );
        }
        // Refresh double-submit cookie so Glade UI can always read a token.
        response.cookies[csrf.CSRF_COOKIE_NAME] = csrf.setCsrfCookie(
          sessionData.csrfToken,
          request,
        );
        $g.csrfToken = sessionData.csrfToken;
      }
    }

    const isLoginPage = request.path.startsWith("/glade/login.html");
    const isLoginApiRequest = request.path === "/glade/login";
    const isLogoutApi = request.path === "/glade/logout";

    if (isSessionValid) {
      if (isLoginPage || isLoginApiRequest) {
        // User is logged in but trying to access login page. Redirect to dashboard.
        log.info(
          "Authenticated user accessing login page. Redirecting to dashboard.",
        );
        response.headers["Location"] = "/glade/index.html";
        response.send(null, 302); // This sets isCompleted = true
        return;
      }

      // H9: mutating Glade operations require CSRF (+ Origin when present).
      // Covers /glade/api/* and logout (session-changing).
      const path = request.path || "";
      const needsCsrf =
        csrf.isUnsafeMethod(request.method) &&
        (path.startsWith("/glade/api/") || isLogoutApi);

      if (needsCsrf) {
        const gate = csrf.assertMutatingRequestAllowed(
          request,
          sessionData,
          ($g.app && $g.app.env) || {},
        );
        if (!gate.ok) {
          log.warn(
            `CSRF/Origin rejected for ${request.method} ${path}: ${gate.reason}`,
          );
          response.send(
            {
              error: "Forbidden",
              code: gate.reason || "CSRF_REJECTED",
              message: gate.message || "CSRF or Origin check failed.",
            },
            gate.status || 403,
          );
          return;
        }
      }
      // If session is valid and not the login page, we do nothing.
      // The middleware finishes, and the main handler will be allowed to run.
    } else {
      // Session is NOT valid.
      const isPublicAsset =
        request.path.startsWith("/glade/css/") ||
        request.path.startsWith("/glade/scripts/") ||
        request.path.startsWith("/glade/images/") ||
        request.path.startsWith("/glade/libs/");

      if (isLoginPage || isLoginApiRequest || isPublicAsset) {
        // Allow access to the login page and its necessary assets.
      } else {
        // Block access to all other pages/APIs.
        log.warn(`Unauthenticated access attempt blocked for: ${request.path}`);
        if (request.path.startsWith("/glade/api/") || isLogoutApi) {
          // For API requests, send a 401 Unauthorized error.
          response.send({ error: "Unauthorized" }, 401);
        } else {
          // For UI pages, redirect to the login page.
          response.headers["Location"] = "/glade/login.html";
          response.send(null, 302);
        }
      }
    }
  });
};
