/**
 * Glade session cookie Path + Secure consistency (login / logout).
 */
const {
  SESSION_PATH,
  SESSION_MAX_AGE_SEC,
  isHttpsRequest,
  buildSessionCookieValue,
  setSessionCookie,
  clearSessionCookie
} = require('../../web/glade/box/session_cookie.js');

describe('glade session_cookie', () => {
  test('SESSION_PATH is /glade', () => {
    expect(SESSION_PATH).toBe('/glade');
  });

  test('isHttpsRequest from protocol and x-forwarded-proto', () => {
    expect(isHttpsRequest({ protocol: 'https', headers: {} })).toBe(true);
    expect(isHttpsRequest({ protocol: 'http', headers: {} })).toBe(false);
    expect(
      isHttpsRequest({
        protocol: 'http',
        headers: { 'x-forwarded-proto': 'https' }
      })
    ).toBe(true);
    expect(
      isHttpsRequest({
        protocol: 'http',
        headers: { 'x-forwarded-proto': 'https, http' }
      })
    ).toBe(true);
    expect(
      isHttpsRequest({
        protocol: 'http',
        headers: { 'x-forwarded-proto': 'http' }
      })
    ).toBe(false);
  });

  test('setSessionCookie includes Path=/glade, HttpOnly, SameSite, Max-Age; Secure only on HTTPS', () => {
    const httpCookie = setSessionCookie('abc123', { protocol: 'http', headers: {} });
    expect(httpCookie.startsWith('abc123;')).toBe(true);
    expect(httpCookie).toContain('HttpOnly');
    expect(httpCookie).toContain('SameSite=Strict');
    expect(httpCookie).toContain('Path=/glade');
    expect(httpCookie).toContain(`Max-Age=${SESSION_MAX_AGE_SEC}`);
    expect(httpCookie).not.toContain('Secure');

    const httpsCookie = setSessionCookie('abc123', { protocol: 'https', headers: {} });
    expect(httpsCookie).toContain('Secure');
    expect(httpsCookie).toContain('Path=/glade');

    const proxied = setSessionCookie('xyz', {
      protocol: 'http',
      headers: { 'x-forwarded-proto': 'https' }
    });
    expect(proxied).toContain('Secure');
  });

  test('clearSessionCookie matches Path and Secure of set cookie', () => {
    const clearHttp = clearSessionCookie({ protocol: 'http', headers: {} });
    expect(clearHttp).toContain('Path=/glade');
    expect(clearHttp).toContain('Max-Age=0');
    expect(clearHttp).toContain('Expires=');
    expect(clearHttp).toContain('HttpOnly');
    expect(clearHttp).toContain('SameSite=Strict');
    expect(clearHttp).not.toContain('Secure');
    // Must NOT use Path=/ (old bug — browser would not clear Path=/glade cookie)
    expect(clearHttp).not.toMatch(/Path=\/;/);
    expect(clearHttp).not.toMatch(/Path=\/$/);

    const clearHttps = clearSessionCookie({ protocol: 'https', headers: {} });
    expect(clearHttps).toContain('Path=/glade');
    expect(clearHttps).toContain('Secure');
  });

  test('buildSessionCookieValue clear vs set', () => {
    const set = buildSessionCookieValue({ value: 'sid', secure: true });
    expect(set).toContain('sid;');
    expect(set).toContain('Secure');
    expect(set).not.toContain('Max-Age=0');

    const clear = buildSessionCookieValue({ value: 'loggedout', clear: true, secure: true });
    expect(clear).toContain('Max-Age=0');
    expect(clear).toContain('Secure');
  });
});
