/**
 * Glade browser CSRF helpers (H9).
 * Reads the Path=/glade double-submit cookie and attaches X-CSRF-Token on mutating fetches.
 *
 * Global: window.GladeCsrf
 */
(function (global) {
  "use strict";

  var CSRF_COOKIE = "glade_csrf";
  var CSRF_HEADER = "X-CSRF-Token";

  function getCookie(name) {
    if (typeof document === "undefined" || !document.cookie) return "";
    var parts = String(document.cookie).split(";");
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (p.indexOf(name + "=") === 0) {
        try {
          return decodeURIComponent(p.slice(name.length + 1));
        } catch (e) {
          return p.slice(name.length + 1);
        }
      }
    }
    return "";
  }

  function getToken() {
    return getCookie(CSRF_COOKIE) || "";
  }

  /**
   * Headers to merge into mutating requests.
   * @returns {Object}
   */
  function headers() {
    var token = getToken();
    var h = {};
    if (token) {
      h[CSRF_HEADER] = token;
    }
    return h;
  }

  function isUnsafeMethod(method) {
    var m = String(method || "GET").toUpperCase();
    return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
  }

  /**
   * fetch wrapper: always credentials include; attach CSRF on unsafe methods.
   * @param {string} url
   * @param {RequestInit} [options]
   * @returns {Promise<Response>}
   */
  function gladeFetch(url, options) {
    var opts = options ? Object.assign({}, options) : {};
    if (opts.credentials == null) {
      opts.credentials = "include";
    }
    var method = opts.method || "GET";
    if (isUnsafeMethod(method)) {
      var csrfHeaders = headers();
      var existing = opts.headers || {};
      if (typeof Headers !== "undefined" && existing instanceof Headers) {
        Object.keys(csrfHeaders).forEach(function (k) {
          if (!existing.has(k)) existing.set(k, csrfHeaders[k]);
        });
        opts.headers = existing;
      } else {
        opts.headers = Object.assign({}, csrfHeaders, existing);
      }
    }
    return fetch(url, opts);
  }

  global.GladeCsrf = {
    COOKIE_NAME: CSRF_COOKIE,
    HEADER_NAME: CSRF_HEADER,
    getToken: getToken,
    headers: headers,
    isUnsafeMethod: isUnsafeMethod,
    fetch: gladeFetch,
  };
})(typeof window !== "undefined" ? window : globalThis);
