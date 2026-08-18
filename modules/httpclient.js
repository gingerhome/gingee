const axios = require("axios");
const querystring = require("querystring");
const FormData = require("form-data");
const { getContext } = require("./gingee.js");
const limits = require("./limits.js");
const egress = require("./egress.js");

/**
 * @module httpclient
 * @description A module for making HTTP requests in Gingee applications.
 * Provides <code>get</code>, <code>post</code>, <code>put</code>, <code>patch</code>, and <code>delete</code>.
 * Body-bearing methods (<code>post</code>/<code>put</code>/<code>patch</code>) support JSON, form-urlencoded,
 * plain text, XML, and multipart via <code>options.postType</code>.
 * Text and binary responses are handled from the content-type header.
 *
 * <b>Timeouts:</b> If <code>options.timeout</code> is omitted, the platform default from
 * <code>gingee.json</code> → <code>limits.outbound_timeout_ms</code> is applied (clamped to the
 * remaining request budget when available). Concurrent outbound calls are also capped.
 *
 * <b>Egress / SSRF:</b> URLs are checked against <code>gingee.json</code> → <code>egress</code>
 * (default mode <code>protected</code> blocks private/loopback/link-local/metadata). Denied calls
 * return status 403 with <code>code: 'EGRESS_DENIED'</code>. When DNS validation yields addresses,
 * connect uses a pinned <code>lookup</code> so resolution cannot rebind between check and TCP connect.
 *
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */

// --- Constants for body content types (post / put / patch) ---
const POST_TYPES = {
  JSON: "application/json",
  FORM: "application/x-www-form-urlencoded",
  TEXT: "text/plain",
  XML: "application/xml",
  MULTIPART: "multipart/form-data",
};

/**
 * Checks the response content-type header to see if it's likely binary.
 * @private
 */
function isBinaryResponse(headers) {
  const contentType = headers["content-type"] || "";
  // Added 'application/json' and 'text/' to the list of non-binary types.
  if (/^text\/|application\/(json|javascript|xml)/.test(contentType)) {
    return false;
  }
  // A more general check for common binary types.
  return /^image\/|audio\/|video\/|application\/(octet-stream|pdf|zip|msword)/.test(
    contentType,
  );
}

/**
 * A helper to process the raw arraybuffer from axios based on response headers.
 * @private
 */
function processBody(data, headers) {
  const bodyBuffer = Buffer.from(data);
  if (isBinaryResponse(headers)) {
    // If it's binary, return the raw Buffer.
    return bodyBuffer;
  }
  // Otherwise, convert the Buffer to a string.
  return bodyBuffer.toString("utf8");
}

/**
 * Build axios config with platform timeout, abort signal, egress redirects, and outbound concurrency.
 * @private
 */
function applyPlatformLimits(options = {}) {
  let store = null;
  try {
    store = getContext();
  } catch (_) {
    store = null;
  }

  const timeout = limits.resolveOutboundTimeoutMs(options.timeout, store);
  const signal =
    options.signal || (store && store.requestAbortSignal) || undefined;

  const outbound = limits.tryAcquireOutbound();
  if (!outbound.ok) {
    try {
      const metrics = require("./metrics.js");
      metrics.inc("gingee_limits_rejected_total", { scope: "outbound" });
    } catch (_) {
      /* ignore */
    }
    const err = new Error(outbound.message);
    err.code = "TOO_MANY_OUTBOUND";
    throw err;
  }

  const maxRedirects =
    options.maxRedirects != null
      ? options.maxRedirects
      : egress.getMaxRedirects();

  return {
    axiosConfig: {
      ...options,
      timeout,
      maxRedirects,
      beforeRedirect: options.beforeRedirect || egress.beforeRedirect,
      ...(signal ? { signal } : {}),
      responseType: "arraybuffer",
    },
    releaseOutbound: outbound.release,
    timeout,
  };
}

/**
 * Normalize axios / network errors into the module's status/body shape.
 * @private
 */
function mapAxiosError(axiosErr) {
  if (axiosErr.response) {
    const body = processBody(axiosErr.response.data, axiosErr.response.headers);
    return {
      status: axiosErr.response.status,
      headers: axiosErr.response.headers,
      body: body,
    };
  }

  const code =
    axiosErr.code ||
    (axiosErr.name === "CanceledError" || axiosErr.name === "AbortError"
      ? "ABORTED"
      : null);
  const isTimeout =
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    /timeout/i.test(axiosErr.message || "");
  const isAbort =
    code === "ERR_CANCELED" ||
    code === "ABORTED" ||
    axiosErr.name === "CanceledError" ||
    axiosErr.name === "AbortError";

  if (isTimeout) {
    return {
      status: 504,
      headers: {},
      body: "Outbound request timed out: " + (axiosErr.message || "timeout"),
      code: "ETIMEDOUT",
    };
  }
  if (isAbort) {
    return {
      status: 499,
      headers: {},
      body: "Outbound request aborted: " + (axiosErr.message || "aborted"),
      code: "ABORTED",
    };
  }
  if (axiosErr.code === "TOO_MANY_OUTBOUND") {
    return {
      status: 503,
      headers: {},
      body: axiosErr.message,
      code: "TOO_MANY_OUTBOUND",
    };
  }
  if (
    axiosErr.code === "EGRESS_DENIED" ||
    (axiosErr.message && String(axiosErr.message).includes("EGRESS_DENIED"))
  ) {
    return {
      status: 403,
      headers: {},
      body: axiosErr.message || "EGRESS_DENIED",
      code: "EGRESS_DENIED",
      reason: axiosErr.reason || null,
    };
  }

  return {
    status: 500,
    headers: {},
    body:
      "Unexpected error occurred: " +
      (axiosErr.message || "No message provided"),
    code: code || "ERROR",
  };
}

/**
 * HTTP request without a body (GET / DELETE).
 * @private
 * @param {'get'|'delete'} method
 * @param {string} url
 * @param {object} [options]
 */
async function requestNoBody(method, url, options = {}) {
  let releaseOutbound = null;
  try {
    const allowed = await egress.assertUrlAllowed(url);
    if (!allowed.ok) {
      return {
        status: 403,
        headers: {},
        body: allowed.message,
        code: "EGRESS_DENIED",
        reason: allowed.reason,
      };
    }

    const prepared = applyPlatformLimits(options);
    releaseOutbound = prepared.releaseOutbound;
    egress.applyConnectPin(prepared.axiosConfig, allowed);
    const response = await axios[method](url, prepared.axiosConfig);
    const body = processBody(response.data, response.headers);
    return {
      status: response.status,
      headers: response.headers,
      body: body,
    };
  } catch (axiosErr) {
    return mapAxiosError(axiosErr);
  } finally {
    if (releaseOutbound) releaseOutbound();
  }
}

/**
 * Encode body for post/put/patch and apply Content-Type.
 * @private
 */
function prepareOutboundBody(body, options, config) {
  const postType = options.postType || POST_TYPES.JSON;
  config.headers = { "Content-Type": postType, ...(options.headers || {}) };

  let data = body;
  if (postType === POST_TYPES.JSON) data = JSON.stringify(body);
  if (postType === POST_TYPES.FORM) data = querystring.stringify(body);
  if (postType === POST_TYPES.MULTIPART) {
    if (!(body instanceof FormData)) {
      throw new Error(
        "For MULTIPART, body must use object created with formdata module.",
      );
    }
    delete config.headers["Content-Type"];
  }
  return data;
}

/**
 * HTTP request with a body (POST / PUT / PATCH).
 * @private
 * @param {'post'|'put'|'patch'} method
 * @param {string} url
 * @param {any} body
 * @param {object} [options]
 */
async function requestWithBody(method, url, body, options = {}) {
  let releaseOutbound = null;

  try {
    const allowed = await egress.assertUrlAllowed(url);
    if (!allowed.ok) {
      return {
        status: 403,
        headers: {},
        body: allowed.message,
        code: "EGRESS_DENIED",
        reason: allowed.reason,
      };
    }

    const prepared = applyPlatformLimits(options);
    releaseOutbound = prepared.releaseOutbound;

    const config = { ...prepared.axiosConfig };
    egress.applyConnectPin(config, allowed);
    const data = prepareOutboundBody(body, options, config);

    const response = await axios[method](url, data, config);
    const responseBody = processBody(response.data, response.headers);
    return {
      status: response.status,
      headers: response.headers,
      body: responseBody,
    };
  } catch (axiosErr) {
    if (axiosErr.message && axiosErr.message.includes("MULTIPART")) {
      throw axiosErr;
    }
    return mapAxiosError(axiosErr);
  } finally {
    if (releaseOutbound) releaseOutbound();
  }
}

/**
 * @function get
 * @memberof module:httpclient
 * @description Performs an HTTP GET request.
 * @param {string} url The URL to request.
 * @param {object} [options] Axios request configuration options (e.g., headers, timeout, signal).
 * @returns {Promise<{status: number, headers: object, body: string|Buffer}>}
 * @example
 * const response = await httpclient.get('https://api.example.com/data');
 */
async function get(url, options = {}) {
  return requestNoBody("get", url, options);
}

/**
 * @function delete
 * @memberof module:httpclient
 * @description Performs an HTTP DELETE request (no body).
 * @param {string} url The URL to request.
 * @param {object} [options] Axios request configuration options (e.g., headers, timeout, signal).
 * @returns {Promise<{status: number, headers: object, body: string|Buffer}>}
 * @example
 * const response = await httpclient.delete('https://api.example.com/items/1');
 */
async function del(url, options = {}) {
  return requestNoBody("delete", url, options);
}

/**
 * @function post
 * @memberof module:httpclient
 * @description Performs an HTTP POST request.
 * @param {string} url The URL to post to.
 * @param {any} body The data to send in the request body.
 * @param {object} [options] Axios request configuration options.
 * @param {string} [options.postType=httpclient.JSON] Body content type.
 * @returns {Promise<{status: number, headers: object, body: string|Buffer}>}
 * @example
 * const response = await httpclient.post('https://api.example.com/data', { key: 'value' });
 */
async function post(url, body, options = {}) {
  return requestWithBody("post", url, body, options);
}

/**
 * @function put
 * @memberof module:httpclient
 * @description Performs an HTTP PUT request (same body / postType options as post).
 * @param {string} url The URL to put to.
 * @param {any} body The data to send in the request body.
 * @param {object} [options] Axios request configuration options.
 * @param {string} [options.postType=httpclient.JSON] Body content type.
 * @returns {Promise<{status: number, headers: object, body: string|Buffer}>}
 * @example
 * const response = await httpclient.put('https://api.example.com/items/1', { name: 'x' });
 */
async function put(url, body, options = {}) {
  return requestWithBody("put", url, body, options);
}

/**
 * @function patch
 * @memberof module:httpclient
 * @description Performs an HTTP PATCH request (same body / postType options as post).
 * @param {string} url The URL to patch.
 * @param {any} body The data to send in the request body.
 * @param {object} [options] Axios request configuration options.
 * @param {string} [options.postType=httpclient.JSON] Body content type.
 * @returns {Promise<{status: number, headers: object, body: string|Buffer}>}
 * @example
 * const response = await httpclient.patch('https://api.example.com/items/1', { name: 'y' });
 */
async function patch(url, body, options = {}) {
  return requestWithBody("patch", url, body, options);
}

module.exports = {
  get,
  post,
  put,
  patch,
  delete: del,
  /**
   * @constant JSON
   * @memberof module:httpclient
   * @description Constant for JSON content type in POST requests.
   * This constant can be used to specify that the POST request body is in JSON format.
   */
  JSON: POST_TYPES.JSON,
  /**
   * @constant FORM
   * @memberof module:httpclient
   * @description Constant for form-urlencoded content type in POST requests.
   * This constant can be used to specify that the POST request body is in form-urlencoded format.
   */
  FORM: POST_TYPES.FORM,
  /**
   * @constant TEXT
   * @memberof module:httpclient
   * @description Constant for plain text content type in POST requests.
   * This constant can be used to specify that the POST request body is in plain text format.
   */
  TEXT: POST_TYPES.TEXT,
  /**
   * @constant XML
   * @memberof module:httpclient
   * @description Constant for XML content type in POST requests.
   * This constant can be used to specify that the POST request body is in XML format.
   */
  XML: POST_TYPES.XML,
  /**
   * @constant MULTIPART
   * @memberof module:httpclient
   * @description Constant for multipart/form-data content type in POST requests.
   * This constant can be used to specify that the POST request body is in multipart/form-data format.
   */
  MULTIPART: POST_TYPES.MULTIPART,
};
