/**
 * Glade CSRF + Origin helpers (H9).
 *
 * Same-origin sibling apps can call `/glade/api/*` with `credentials: 'include'`
 * because the session cookie is scoped by Path, not by document URL. SameSite
 * blocks cross-site CSRF only.
 *
 * Defense:
 * 1. Session-bound CSRF token (stored server-side) mirrored in a non-HttpOnly
 *    cookie Path=/glade so only Glade pages can read it and send X-CSRF-Token.
 * 2. Origin/Referer must match this host (or GLADE_ALLOWED_ORIGINS) when present.
 *
 * Dedicated Glade host/port remains the strongest deployment isolation.
 */

const { isHttpsRequest, SESSION_PATH } = require("./session_cookie.js");

const CSRF_COOKIE_NAME = "glade_csrf";
const CSRF_HEADER_NAME = "x-csrf-token";
const CSRF_MAX_AGE_SEC = 28800; // align with session

/**
 * True for methods that may change state and must carry CSRF.
 * @param {string} method
 * @returns {boolean}
 */
function isUnsafeMethod(method) {
  const m = String(method || "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

/**
 * @param {object} cryptoMod - Gingee crypto module (generateSecureRandomString)
 * @returns {string}
 */
function createCsrfToken(cryptoMod) {
  if (
    !cryptoMod ||
    typeof cryptoMod.generateSecureRandomString !== "function"
  ) {
    throw new Error(
      "createCsrfToken requires crypto.generateSecureRandomString",
    );
  }
  return cryptoMod.generateSecureRandomString(32);
}

/**
 * Build Set-Cookie value for CSRF double-submit cookie (NOT HttpOnly).
 * @param {object} opts
 * @param {string} opts.value
 * @param {boolean} [opts.clear]
 * @param {boolean} [opts.secure]
 * @param {number} [opts.maxAgeSec]
 * @returns {string}
 */
function buildCsrfCookieValue(opts) {
  const o = opts || {};
  const value = o.value != null ? String(o.value) : "";
  const parts = [value];
  // Readable by Glade scripts under Path=/glade only — sibling apps cannot document.cookie this.
  parts.push("SameSite=Strict");
  parts.push(`Path=${SESSION_PATH}`);
  if (o.clear) {
    parts.push("Expires=Thu, 01 Jan 1970 00:00:00 GMT");
    parts.push("Max-Age=0");
  } else {
    const maxAge =
      o.maxAgeSec != null && Number.isFinite(Number(o.maxAgeSec))
        ? Math.max(0, Math.floor(Number(o.maxAgeSec)))
        : CSRF_MAX_AGE_SEC;
    parts.push(`Max-Age=${maxAge}`);
  }
  if (o.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

/**
 * @param {string} token
 * @param {object} request
 * @returns {string}
 */
function setCsrfCookie(token, request) {
  return buildCsrfCookieValue({
    value: token,
    clear: false,
    secure: isHttpsRequest(request),
    maxAgeSec: CSRF_MAX_AGE_SEC,
  });
}

/**
 * @param {object} request
 * @returns {string}
 */
function clearCsrfCookie(request) {
  return buildCsrfCookieValue({
    value: "cleared",
    clear: true,
    secure: isHttpsRequest(request),
  });
}

/**
 * Read CSRF token from request headers or body.
 * @param {object} request - $g.request
 * @returns {string|null}
 */
function extractCsrfFromRequest(request) {
  if (!request) return null;
  const headers = request.headers || {};
  const headerKeys = [CSRF_HEADER_NAME, "X-CSRF-Token", "x-csrf-token"];
  for (const k of headerKeys) {
    if (headers[k] != null && String(headers[k]).length > 0) {
      return String(headers[k]).trim();
    }
  }
  // Node lowercases headers
  for (const [k, v] of Object.entries(headers)) {
    if (
      String(k).toLowerCase() === CSRF_HEADER_NAME &&
      v != null &&
      String(v).length > 0
    ) {
      return String(v).trim();
    }
  }
  const body = request.body;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    if (body._csrf != null && String(body._csrf).length > 0) {
      return String(body._csrf).trim();
    }
    if (body.csrfToken != null && String(body.csrfToken).length > 0) {
      return String(body.csrfToken).trim();
    }
  }
  // Cookie double-submit value (client should also send header; we still compare session)
  const cookies = request.cookies || {};
  if (cookies[CSRF_COOKIE_NAME]) {
    return String(cookies[CSRF_COOKIE_NAME]).trim();
  }
  return null;
}

/**
 * Constant-time string compare for tokens.
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualString(a, b) {
  const sa = String(a || "");
  const sb = String(b || "");
  if (sa.length !== sb.length) return false;
  let out = 0;
  for (let i = 0; i < sa.length; i++) {
    out |= sa.charCodeAt(i) ^ sb.charCodeAt(i);
  }
  return out === 0;
}

/**
 * Validate CSRF token against session-stored token.
 * Prefer header/body token; cookie alone is weaker but accepted if it matches session
 * (defense for non-JS clients that only mirror cookie).
 *
 * @param {object} request
 * @param {object} sessionData - must include csrfToken
 * @returns {{ ok: true } | { ok: false, reason: string, message: string }}
 */
function validateCsrf(request, sessionData) {
  const expected = sessionData && sessionData.csrfToken;
  if (!expected || typeof expected !== "string" || expected.length < 16) {
    return {
      ok: false,
      reason: "CSRF_MISSING_SESSION",
      message: "Session has no CSRF token; re-login required.",
    };
  }

  const headers = (request && request.headers) || {};
  let headerToken = null;
  for (const [k, v] of Object.entries(headers)) {
    if (
      String(k).toLowerCase() === CSRF_HEADER_NAME &&
      v != null &&
      String(v).length > 0
    ) {
      headerToken = String(v).trim();
      break;
    }
  }
  const body = request && request.body;
  let bodyToken = null;
  if (body && typeof body === "object" && !Buffer.isBuffer(body)) {
    if (body._csrf != null) bodyToken = String(body._csrf).trim();
    else if (body.csrfToken != null) bodyToken = String(body.csrfToken).trim();
  }
  const cookieToken =
    request && request.cookies && request.cookies[CSRF_COOKIE_NAME]
      ? String(request.cookies[CSRF_COOKIE_NAME]).trim()
      : null;

  // Require explicit header or body token (not cookie alone) so simple cookie-only
  // credentialed requests from sibling apps cannot succeed without reading the token.
  const presented = headerToken || bodyToken;
  if (!presented) {
    return {
      ok: false,
      reason: "CSRF_TOKEN_REQUIRED",
      message: "Missing X-CSRF-Token header for mutating request.",
    };
  }
  if (!timingSafeEqualString(presented, expected)) {
    return {
      ok: false,
      reason: "CSRF_MISMATCH",
      message: "Invalid CSRF token.",
    };
  }
  // Optional: cookie should match when present (double-submit)
  if (cookieToken && !timingSafeEqualString(cookieToken, expected)) {
    return {
      ok: false,
      reason: "CSRF_COOKIE_MISMATCH",
      message: "CSRF cookie does not match session.",
    };
  }
  return { ok: true };
}

/**
 * Resolve allowed origins for this request.
 * Always includes the origin derived from Host + protocol; plus app env list.
 *
 * @param {object} request
 * @param {object} [appEnv] - $g.app.env
 * @returns {string[]}
 */
function resolveAllowedOrigins(request, appEnv) {
  const allowed = new Set();
  const host =
    (request &&
      request.headers &&
      (request.headers.host || request.headers.Host)) ||
    request.hostname ||
    null;
  if (host) {
    const https = isHttpsRequest(request);
    // Trust x-forwarded-proto already via isHttpsRequest
    allowed.add(`${https ? "https" : "http"}://${host}`);
    // Common local dev variants
    if (
      String(host).startsWith("localhost") ||
      String(host).startsWith("127.0.0.1")
    ) {
      allowed.add(`http://${host}`);
      allowed.add(`https://${host}`);
    }
  }

  const env = appEnv || {};
  const raw =
    env.GLADE_ALLOWED_ORIGINS ||
    env.ALLOWED_ORIGINS ||
    env.glade_allowed_origins ||
    "";
  if (raw) {
    String(raw)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((o) => allowed.add(o.replace(/\/$/, "")));
  }
  return [...allowed];
}

/**
 * Extract Origin from Origin header or Referer.
 * @param {object} request
 * @returns {string|null}
 */
function extractRequestOrigin(request) {
  if (!request || !request.headers) return null;
  const headers = request.headers;
  const origin = headers.origin || headers.Origin;
  if (origin && String(origin).trim()) {
    return String(origin).trim().replace(/\/$/, "");
  }
  const referer = headers.referer || headers.Referer;
  if (referer) {
    try {
      return new URL(String(referer)).origin;
    } catch (_) {
      return null;
    }
  }
  return null;
}

/**
 * Origin/Referer check for mutating requests (cross-site residual).
 * Same-host sibling apps share Origin — CSRF token is required for that case.
 *
 * @param {object} request
 * @param {object} [appEnv]
 * @returns {{ ok: true } | { ok: false, reason: string, message: string }}
 */
function validateOrigin(request, appEnv) {
  const presented = extractRequestOrigin(request);
  // No Origin/Referer: allow only if CSRF will still be enforced (browser fetch usually sends Origin).
  // Reject empty Origin when we cannot establish same-host — still ok for CSRF path.
  if (!presented) {
    return { ok: true, reason: "ORIGIN_ABSENT" };
  }
  const allowed = resolveAllowedOrigins(request, appEnv);
  if (allowed.includes(presented)) {
    return { ok: true };
  }
  return {
    ok: false,
    reason: "ORIGIN_MISMATCH",
    message: `Origin not allowed for Glade admin: ${presented}`,
  };
}

/**
 * Full mutating-request gate: Origin then CSRF.
 * @param {object} request
 * @param {object} sessionData
 * @param {object} [appEnv]
 * @returns {{ ok: true } | { ok: false, reason: string, message: string, status: number }}
 */
function assertMutatingRequestAllowed(request, sessionData, appEnv) {
  if (!isUnsafeMethod(request && request.method)) {
    return { ok: true };
  }
  const originCheck = validateOrigin(request, appEnv);
  if (!originCheck.ok) {
    return { ...originCheck, status: 403 };
  }
  const csrfCheck = validateCsrf(request, sessionData);
  if (!csrfCheck.ok) {
    return { ...csrfCheck, status: 403 };
  }
  return { ok: true };
}

module.exports = {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  CSRF_MAX_AGE_SEC,
  isUnsafeMethod,
  createCsrfToken,
  buildCsrfCookieValue,
  setCsrfCookie,
  clearCsrfCookie,
  extractCsrfFromRequest,
  timingSafeEqualString,
  validateCsrf,
  resolveAllowedOrigins,
  extractRequestOrigin,
  validateOrigin,
  assertMutatingRequestAllowed,
};
