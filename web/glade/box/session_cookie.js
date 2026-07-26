/**
 * Glade session cookie attribute helpers.
 * Login and logout must use the same Path (and Secure when HTTPS) so the browser
 * can clear the cookie on logout.
 */

const SESSION_COOKIE_NAME = 'sessionId';
const SESSION_PATH = '/glade';
/** Match cache session TTL used at login (8 hours). */
const SESSION_MAX_AGE_SEC = 28800;

/**
 * True when the request should be treated as HTTPS (direct TLS or reverse proxy).
 * @param {object} request - $g.request shape { protocol, headers }
 * @returns {boolean}
 */
function isHttpsRequest(request) {
  if (!request) return false;
  if (String(request.protocol || '').toLowerCase() === 'https') return true;
  const headers = request.headers || {};
  const xf = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'];
  if (xf && String(xf).split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }
  return false;
}

/**
 * Build Set-Cookie value attributes for the Glade session cookie (after `name=`).
 * @param {object} opts
 * @param {string} opts.value - cookie value (session id or dummy when clearing)
 * @param {boolean} [opts.clear=false] - expire immediately
 * @param {boolean} [opts.secure=false] - add Secure flag
 * @param {number} [opts.maxAgeSec] - Max-Age when not clearing (default SESSION_MAX_AGE_SEC)
 * @returns {string} e.g. "abc; HttpOnly; SameSite=Strict; Path=/glade; Secure"
 */
function buildSessionCookieValue(opts) {
  const o = opts || {};
  const value = o.value != null ? String(o.value) : '';
  const parts = [value];
  parts.push('HttpOnly');
  parts.push('SameSite=Strict');
  parts.push(`Path=${SESSION_PATH}`);
  if (o.clear) {
    parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
    parts.push('Max-Age=0');
  } else {
    const maxAge =
      o.maxAgeSec != null && Number.isFinite(Number(o.maxAgeSec))
        ? Math.max(0, Math.floor(Number(o.maxAgeSec)))
        : SESSION_MAX_AGE_SEC;
    parts.push(`Max-Age=${maxAge}`);
  }
  if (o.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

/**
 * Cookie string for a new session id.
 * @param {string} sessionId
 * @param {object} request - $g.request
 * @returns {string}
 */
function setSessionCookie(sessionId, request) {
  return buildSessionCookieValue({
    value: sessionId,
    clear: false,
    secure: isHttpsRequest(request),
    maxAgeSec: SESSION_MAX_AGE_SEC
  });
}

/**
 * Cookie string that clears the session cookie (must match Path/Secure of set).
 * @param {object} request - $g.request
 * @returns {string}
 */
function clearSessionCookie(request) {
  return buildSessionCookieValue({
    value: 'loggedout',
    clear: true,
    secure: isHttpsRequest(request)
  });
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_PATH,
  SESSION_MAX_AGE_SEC,
  isHttpsRequest,
  buildSessionCookieValue,
  setSessionCookie,
  clearSessionCookie
};
