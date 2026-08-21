/**
 * @module engine/request/cache_config
 * @description Compile and match app.json cache.no_cache_regex lists;
 * cache app web/box realpaths for jail checks.
 * Engine-internal — refreshed on app register / reload.
 */

const { resolveRealPath } = require("../../internal_utils.js");

/**
 * Compile string patterns to RegExp[]. Invalid patterns are skipped.
 * @param {string[]|undefined|null} patterns
 * @returns {RegExp[]}
 */
function compileNoCacheRegex(patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) {
    return [];
  }
  const out = [];
  for (const p of patterns) {
    if (p instanceof RegExp) {
      out.push(p);
      continue;
    }
    if (typeof p !== "string" || p.length === 0) {
      continue;
    }
    try {
      out.push(new RegExp(p));
    } catch (_) {
      /* skip invalid pattern */
    }
  }
  return out;
}

/**
 * @param {RegExp[]|undefined|null} compiled
 * @param {string} url
 * @returns {boolean}
 */
function matchesNoCache(compiled, url) {
  if (!compiled || compiled.length === 0) {
    return false;
  }
  const target = url == null ? "" : String(url);
  for (const re of compiled) {
    if (re.test(target)) {
      return true;
    }
  }
  return false;
}

/**
 * Cache realpath-expanded app web/box roots (refresh on reload).
 * Candidates are still realpath-expanded on each jail check (H12).
 * @param {object} app
 */
function attachAppPathReals(app) {
  if (!app) return;
  if (app.appWebPath) {
    app.appWebPathReal = resolveRealPath(app.appWebPath);
  }
  if (app.appBoxPath) {
    app.appBoxPathReal = resolveRealPath(app.appBoxPath);
  }
}

/**
 * Normalize cache config nested objects and attach compiled regex lists on the app.
 * Also refreshes app web/box realpath caches. Call after loading/reloading app.json.
 *
 * @param {object} app - live app registry entry (`app.config.cache`)
 * @returns {object} app.compiledCacheRegex
 */
function attachCompiledCacheRegex(app) {
  if (!app || !app.config) {
    return { clientNoCache: [], serverNoCache: [] };
  }
  const defaults = {
    client: { enabled: false, no_cache_regex: [] },
    server: { enabled: false, no_cache_regex: [] },
  };
  const cache = app.config.cache || {};
  app.config.cache = {
    client: { ...defaults.client, ...(cache.client || {}) },
    server: { ...defaults.server, ...(cache.server || {}) },
  };
  if (!Array.isArray(app.config.cache.client.no_cache_regex)) {
    app.config.cache.client.no_cache_regex = [];
  }
  if (!Array.isArray(app.config.cache.server.no_cache_regex)) {
    app.config.cache.server.no_cache_regex = [];
  }

  app.compiledCacheRegex = {
    clientNoCache: compileNoCacheRegex(
      app.config.cache.client.no_cache_regex,
    ),
    serverNoCache: compileNoCacheRegex(
      app.config.cache.server.no_cache_regex,
    ),
  };
  attachAppPathReals(app);
  return app.compiledCacheRegex;
}

/**
 * Prefer app.compiledCacheRegex; fall back to compiling from cacheConfig (tests / edge).
 * @param {object} app
 * @param {object} cacheConfig - app.config.cache shape
 * @returns {{ clientNoCache: RegExp[], serverNoCache: RegExp[] }}
 */
function resolveCompiledCacheRegex(app, cacheConfig) {
  if (app && app.compiledCacheRegex) {
    return app.compiledCacheRegex;
  }
  const client = (cacheConfig && cacheConfig.client) || {};
  const server = (cacheConfig && cacheConfig.server) || {};
  return {
    clientNoCache: compileNoCacheRegex(client.no_cache_regex),
    serverNoCache: compileNoCacheRegex(server.no_cache_regex),
  };
}

module.exports = {
  compileNoCacheRegex,
  matchesNoCache,
  attachAppPathReals,
  attachCompiledCacheRegex,
  resolveCompiledCacheRegex,
};
