module.exports = async function () {
  gingee(async ($g) => {
    const crypto = require("crypto");
    const cacheService = require("cache_service");
    const sessionCookie = require("./session_cookie.js");
    const csrf = require("./csrf.js");
    const loginRateLimit = require("./login_rate_limit.js");

    try {
      const { username, password } = $g.request.body || {};
      const { ADMIN_USERNAME, ADMIN_PASSWORD_HASH } = $g.app.env;
      const rateCfg = loginRateLimit.resolveConfig($g.app.env);

      // Raw socket IP when available (ALS store) for rate keys without proxy headers.
      let nodeReq = null;
      try {
        const { getContext } = require("gingee");
        const store = getContext();
        nodeReq = store && store.req;
      } catch (_) {
        nodeReq = null;
      }

      const identity = {
        ip: loginRateLimit.clientIp($g.request, nodeReq),
        username: username || "",
      };

      // M19: throttle before expensive Argon2 verify.
      const allowed = await loginRateLimit.assertLoginAllowed(
        cacheService,
        identity,
        rateCfg,
      );
      if (!allowed.ok) {
        $g.response.headers["Retry-After"] = String(
          allowed.retryAfterSec || rateCfg.lockoutSec,
        );
        return $g.response.send(
          {
            code: 429,
            message: allowed.message,
            reason: allowed.reason,
            retryAfterSec: allowed.retryAfterSec,
          },
          429,
        );
      }

      if (!username || !password) {
        return $g.response.send(
          { code: 400, message: "Username and password are required." },
          400,
        );
      }

      // 1. Verify username (same error path as bad password — no user enumeration)
      if (username !== ADMIN_USERNAME) {
        const fail = await loginRateLimit.recordFailure(
          cacheService,
          identity,
          rateCfg,
        );
        if (fail.locked) {
          $g.response.headers["Retry-After"] = String(
            fail.retryAfterSec || rateCfg.lockoutSec,
          );
          return $g.response.send(
            {
              code: 429,
              message: `Too many failed login attempts. Try again in ${fail.retryAfterSec || rateCfg.lockoutSec} seconds.`,
              reason: "LOGIN_RATE_LIMITED",
              retryAfterSec: fail.retryAfterSec || rateCfg.lockoutSec,
            },
            429,
          );
        }
        return $g.response.send(
          { code: 401, message: "Invalid credentials." },
          401,
        );
      }

      // 2. Verify password hash
      const isPasswordCorrect = await crypto.verifyPassword(
        password,
        ADMIN_PASSWORD_HASH,
      );
      if (!isPasswordCorrect) {
        const fail = await loginRateLimit.recordFailure(
          cacheService,
          identity,
          rateCfg,
        );
        if (fail.locked) {
          $g.response.headers["Retry-After"] = String(
            fail.retryAfterSec || rateCfg.lockoutSec,
          );
          return $g.response.send(
            {
              code: 429,
              message: `Too many failed login attempts. Try again in ${fail.retryAfterSec || rateCfg.lockoutSec} seconds.`,
              reason: "LOGIN_RATE_LIMITED",
              retryAfterSec: fail.retryAfterSec || rateCfg.lockoutSec,
            },
            429,
          );
        }
        return $g.response.send(
          { code: 401, message: "Invalid credentials." },
          401,
        );
      }

      // Success: clear rate-limit counters for this IP/user
      await loginRateLimit.clearFailures(cacheService, identity);

      // 3. Create a session + CSRF token (H9)
      const sessionId = crypto.generateSecureRandomString(32);
      const csrfToken = csrf.createCsrfToken(crypto);
      const sessionData = {
        user: username,
        loggedInAt: new Date().toISOString(),
        csrfToken,
      };
      // Session expires in 8 hours (28800 seconds) — keep cache TTL and Max-Age aligned
      await cacheService.set(
        `session:${sessionId}`,
        sessionData,
        sessionCookie.SESSION_MAX_AGE_SEC,
      );

      // 4. Set the session cookie (Path=/glade; Secure when HTTPS) + CSRF double-submit cookie
      $g.response.cookies.sessionId = sessionCookie.setSessionCookie(
        sessionId,
        $g.request,
      );
      $g.response.cookies[csrf.CSRF_COOKIE_NAME] = csrf.setCsrfCookie(
        csrfToken,
        $g.request,
      );

      $g.response.send({
        code: 200,
        status: "success",
        // Client may use this immediately; cookie is also set for subsequent page loads.
        csrfToken,
      });
    } catch (err) {
      $g.log.error("Login error:", { error: err.message });
      $g.response.send(
        { code: 500, message: "An internal error occurred." },
        500,
      );
    }
  });
};
