/**
 * HTML escaping for Glade client UI (XSS defense when building HTML strings).
 * Shared by cl_dashboard.js and cl_packconfig.js.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.GladeEscape = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  /**
   * Escape text for HTML body content and double-quoted attributes.
   * @param {*} s
   * @returns {string}
   */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /**
   * Escape for use inside single-quoted HTML attributes (rare).
   * @param {*} s
   * @returns {string}
   */
  function escapeAttr(s) {
    return escapeHtml(s);
  }

  return {
    escapeHtml,
    escapeAttr,
  };
});
