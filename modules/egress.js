const dns = require('dns');
const dnsPromises = dns.promises;
const net = require('net');
const { URL } = require('url');

/**
 * @module egress
 * @description
 * Outbound URL policy (SSRF hardening) for httpclient and scheduler URL jobs.
 *
 * <b>Server config:</b> <code>gingee.json</code> → <code>egress</code>
 *
 * <b>Modes:</b>
 * - <code>protected</code> (default): block loopback, private, link-local, metadata; allow public internet
 * - <code>allowlist</code>: only hosts matching <code>allow_hosts</code> (metadata still force-blocked)
 * - <code>off</code>: no checks (local dev only)
 *
 * Engine-internal (not for sandboxed app require).
 */

const DEFAULTS = {
  mode: 'protected', // protected | allowlist | off
  https_only: false,
  dns_check: true,
  max_redirects: 3,
  block_private: true,
  block_loopback: true,
  block_link_local: true,
  block_metadata: true,
  allow_hosts: [],
  allow_cidrs: [],
  deny_hosts: [],
  deny_cidrs: []
};

/** Well-known cloud metadata / internal names (always blocked except mode=off). */
const METADATA_HOSTS = new Set([
  'metadata',
  'metadata.google.internal',
  'metadata.goog',
  'instance-data',
  'kubernetes.default',
  'kubernetes.default.svc'
]);

/** @type {object} */
let config = { ...DEFAULTS, allow_hosts: [], allow_cidrs: [], deny_hosts: [], deny_cidrs: [] };

/** @type {object|null} */
let logger = null;

/**
 * @private
 */
function log() {
  return logger || console;
}

/**
 * @private
 */
function asStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim().toLowerCase()).filter(Boolean);
}

/**
 * @private
 */
function asCidrArray(v) {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x).trim()).filter(Boolean);
}

/**
 * Initialize egress policy from gingee.json.
 * @param {object|null|undefined} cfg
 * @param {object} [logRef]
 */
function initServer(cfg, logRef) {
  logger = logRef || console;
  const c = cfg && typeof cfg === 'object' && !Array.isArray(cfg) ? cfg : {};
  let mode = c.mode != null ? String(c.mode).toLowerCase() : DEFAULTS.mode;
  if (!['protected', 'allowlist', 'off'].includes(mode)) {
    log().warn(`[egress] Unknown mode '${mode}', falling back to 'protected'`);
    mode = 'protected';
  }
  config = {
    mode,
    https_only: c.https_only === true,
    dns_check: c.dns_check !== false,
    max_redirects:
      c.max_redirects != null && Number.isFinite(Number(c.max_redirects))
        ? Math.max(0, Math.floor(Number(c.max_redirects)))
        : DEFAULTS.max_redirects,
    block_private: c.block_private !== false,
    block_loopback: c.block_loopback !== false,
    block_link_local: c.block_link_local !== false,
    block_metadata: c.block_metadata !== false,
    allow_hosts: asStringArray(c.allow_hosts),
    allow_cidrs: asCidrArray(c.allow_cidrs),
    deny_hosts: asStringArray(c.deny_hosts),
    deny_cidrs: asCidrArray(c.deny_cidrs)
  };
  log().info(
    `[egress] mode=${config.mode} https_only=${config.https_only} dns_check=${config.dns_check} max_redirects=${config.max_redirects}`
  );
}

function getConfig() {
  return {
    ...config,
    allow_hosts: [...config.allow_hosts],
    allow_cidrs: [...config.allow_cidrs],
    deny_hosts: [...config.deny_hosts],
    deny_cidrs: [...config.deny_cidrs]
  };
}

/**
 * Parse IPv4 dotted quad to uint32.
 * @private
 */
function ipv4ToInt(ip) {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

/**
 * @private
 */
function parseCidr(cidr) {
  const s = String(cidr).trim();
  if (s.includes(':')) {
    // IPv6 CIDR — basic support via prefix match on normalized form is complex;
    // support only exact single address as /128 style "addr" or "addr/prefix" with prefix 128 only for v1 extras.
    const [addr, prefixStr] = s.split('/');
    const prefix = prefixStr != null ? Number(prefixStr) : 128;
    if (!net.isIPv6(addr) || !Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
      return null;
    }
    return { family: 6, addr: addr.toLowerCase(), prefix };
  }
  const [addr, prefixStr] = s.split('/');
  const prefix = prefixStr != null ? Number(prefixStr) : 32;
  const ipInt = ipv4ToInt(addr);
  if (ipInt == null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
  return { family: 4, network: (ipInt & mask) >>> 0, mask, prefix };
}

/**
 * @private
 */
function ipv4InCidr(ip, cidrObj) {
  if (!cidrObj || cidrObj.family !== 4) return false;
  const ipInt = ipv4ToInt(ip);
  if (ipInt == null) return false;
  return (ipInt & cidrObj.mask) >>> 0 === cidrObj.network;
}

/**
 * Expand IPv4-mapped IPv6 to IPv4 if applicable.
 * @private
 */
function unwrapIp(ip) {
  const s = String(ip).toLowerCase();
  if (s.startsWith('::ffff:')) {
    const rest = s.slice(7);
    if (net.isIPv4(rest)) return { family: 4, ip: rest };
  }
  if (net.isIPv4(s)) return { family: 4, ip: s };
  if (net.isIPv6(s)) return { family: 6, ip: s };
  return null;
}

/**
 * Classify an IP address for SSRF policy.
 * @param {string} ip
 * @returns {{ kind: string, blockedByDefault: boolean }}
 */
function classifyIp(ip) {
  const u = unwrapIp(ip);
  if (!u) return { kind: 'invalid', blockedByDefault: true };

  if (u.family === 4) {
    const n = ipv4ToInt(u.ip);
    if (n == null) return { kind: 'invalid', blockedByDefault: true };

    // 0.0.0.0/8
    if ((n >>> 24) === 0) return { kind: 'unspecified', blockedByDefault: true };
    // 127.0.0.0/8 loopback
    if ((n >>> 24) === 127) return { kind: 'loopback', blockedByDefault: true };
    // 10.0.0.0/8
    if ((n >>> 24) === 10) return { kind: 'private', blockedByDefault: true };
    // 172.16.0.0/12
    if ((n >>> 24) === 172 && ((n >>> 16) & 0xf0) === 16) {
      return { kind: 'private', blockedByDefault: true };
    }
    // 192.168.0.0/16
    if ((n >>> 24) === 192 && ((n >>> 16) & 0xff) === 168) {
      return { kind: 'private', blockedByDefault: true };
    }
    // 169.254.0.0/16 link-local (metadata)
    if ((n >>> 24) === 169 && ((n >>> 16) & 0xff) === 254) {
      return { kind: 'link_local', blockedByDefault: true };
    }
    // 100.64.0.0/10 CGNAT
    if ((n >>> 24) === 100 && ((n >>> 16) & 0xc0) === 64) {
      return { kind: 'cgnat', blockedByDefault: true };
    }
    // 224.0.0.0/4 multicast
    if ((n >>> 28) === 0xe) return { kind: 'multicast', blockedByDefault: true };
    // 255.255.255.255
    if (n === 0xffffffff) return { kind: 'broadcast', blockedByDefault: true };

    return { kind: 'public', blockedByDefault: false };
  }

  // IPv6
  const ip6 = u.ip;
  if (ip6 === '::1') return { kind: 'loopback', blockedByDefault: true };
  if (ip6 === '::') return { kind: 'unspecified', blockedByDefault: true };
  // fe80::/10 link-local
  if (/^fe[89ab][0-9a-f]:/i.test(ip6) || ip6.startsWith('fe80:')) {
    return { kind: 'link_local', blockedByDefault: true };
  }
  // fc00::/7 ULA
  if (/^f[cd][0-9a-f]{2}:/i.test(ip6)) {
    return { kind: 'private', blockedByDefault: true };
  }
  // ff00::/8 multicast
  if (ip6.startsWith('ff')) return { kind: 'multicast', blockedByDefault: true };

  return { kind: 'public', blockedByDefault: false };
}

/**
 * @private
 */
function hostMatchesPattern(host, pattern) {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  if (p.startsWith('*.')) {
    const suffix = p.slice(1); // .example.com
    return h.endsWith(suffix) && h.length > suffix.length;
  }
  return h === p;
}

/**
 * @private
 */
function isMetadataHost(host) {
  const h = host.toLowerCase().replace(/\.$/, '');
  if (METADATA_HOSTS.has(h)) return true;
  if (h.endsWith('.metadata.google.internal')) return true;
  return false;
}

/**
 * Whether an IP is allowed under current policy (after class + deny/allow CIDRs).
 * @private
 */
function isIpAllowed(ip) {
  const cls = classifyIp(ip);

  // Explicit deny CIDRs always win
  for (const c of config.deny_cidrs) {
    const parsed = parseCidr(c);
    if (parsed && parsed.family === 4) {
      const u = unwrapIp(ip);
      if (u && u.family === 4 && ipv4InCidr(u.ip, parsed)) {
        return { ok: false, reason: 'DENY_CIDR', detail: c };
      }
    }
  }

  // Explicit allow CIDRs (exception for private etc.)
  for (const c of config.allow_cidrs) {
    const parsed = parseCidr(c);
    if (parsed && parsed.family === 4) {
      const u = unwrapIp(ip);
      if (u && u.family === 4 && ipv4InCidr(u.ip, parsed)) {
        return { ok: true, reason: 'ALLOW_CIDR', detail: c };
      }
    }
  }

  if (cls.kind === 'invalid') {
    return { ok: false, reason: 'INVALID_IP', detail: ip };
  }

  // Metadata / link-local always sensitive
  if (cls.kind === 'link_local' && config.block_link_local) {
    return { ok: false, reason: 'BLOCKED_LINK_LOCAL', detail: ip };
  }
  if (cls.kind === 'loopback' && config.block_loopback) {
    return { ok: false, reason: 'BLOCKED_LOOPBACK', detail: ip };
  }
  if (
    (cls.kind === 'private' || cls.kind === 'cgnat') &&
    config.block_private
  ) {
    return { ok: false, reason: 'BLOCKED_PRIVATE', detail: ip };
  }
  if (
    (cls.kind === 'unspecified' ||
      cls.kind === 'multicast' ||
      cls.kind === 'broadcast') &&
    cls.blockedByDefault
  ) {
    return { ok: false, reason: 'BLOCKED_SPECIAL', detail: `${cls.kind}:${ip}` };
  }

  return { ok: true, reason: 'OK', detail: cls.kind };
}

/**
 * Assert a URL is allowed under egress policy.
 * @param {string} urlString
 * @param {object} [options]
 * @param {boolean} [options.skipDns]
 * @returns {Promise<{ ok: true, url: string, host: string } | { ok: false, code: string, message: string, reason: string }>}
 */
async function assertUrlAllowed(urlString, options = {}) {
  if (config.mode === 'off') {
    return { ok: true, url: String(urlString), host: null };
  }

  let parsed;
  try {
    parsed = new URL(String(urlString));
  } catch (_) {
    return deny('INVALID_URL', `Invalid URL: ${urlString}`);
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    return deny('SCHEME', `URL scheme not allowed: ${protocol}`);
  }
  if (config.https_only && protocol !== 'https:') {
    return deny('HTTPS_ONLY', 'Only https: URLs are allowed by egress policy');
  }

  let host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) {
    return deny('INVALID_HOST', 'URL has no hostname');
  }

  // Userinfo often used in SSRF tricks — reject
  if (parsed.username || parsed.password) {
    return deny('USERINFO', 'URLs with embedded credentials are not allowed');
  }

  // Deny hosts list
  for (const d of config.deny_hosts) {
    if (hostMatchesPattern(host, d)) {
      return deny('DENY_HOST', `Host denied by policy: ${host}`);
    }
  }

  // Metadata hostnames — force block in protected/allowlist
  if (config.block_metadata && isMetadataHost(host)) {
    return deny('BLOCKED_METADATA', `Metadata host blocked: ${host}`);
  }

  // Literal IP hostname
  if (net.isIP(host)) {
    // Link-local metadata IP always blocked when block_metadata or block_link_local
    const cls = classifyIp(host);
    if (
      config.block_metadata &&
      (cls.kind === 'link_local' || host === '169.254.169.254')
    ) {
      return deny('BLOCKED_METADATA', `Metadata IP blocked: ${host}`);
    }
    const ipCheck = isIpAllowed(host);
    if (!ipCheck.ok) {
      return deny(ipCheck.reason, `IP not allowed: ${host} (${ipCheck.reason})`);
    }
  }

  // Allowlist mode
  if (config.mode === 'allowlist') {
    const allowed = config.allow_hosts.some((p) => hostMatchesPattern(host, p));
    if (!allowed && !net.isIP(host)) {
      return deny('ALLOWLIST', `Host not on allowlist: ${host}`);
    }
    // Literal IP in allowlist mode must match allow_cidrs
    if (net.isIP(host)) {
      let cidrOk = false;
      for (const c of config.allow_cidrs) {
        const parsedCidr = parseCidr(c);
        const u = unwrapIp(host);
        if (parsedCidr && parsedCidr.family === 4 && u && u.family === 4 && ipv4InCidr(u.ip, parsedCidr)) {
          cidrOk = true;
          break;
        }
      }
      if (!cidrOk) {
        return deny('ALLOWLIST', `IP not on allow_cidrs: ${host}`);
      }
    }
  }

  // Protected mode: DNS check for hostnames
  if (
    config.mode === 'protected' &&
    config.dns_check &&
    !options.skipDns &&
    !net.isIP(host)
  ) {
    const dnsResult = await resolveAndCheckHost(host, options.syncDns === true);
    if (!dnsResult.ok) return dnsResult;
  }

  return { ok: true, url: parsed.toString(), host };
}

/**
 * @private
 * @param {string} host
 * @param {boolean} sync
 */
async function resolveAndCheckHost(host, sync) {
  try {
    let records;
    if (sync) {
      // lookupSync returns single address; also try resolve4/6 if needed — use promises all for async path.
      const addr = dns.lookupSync(host, { all: true, verbatim: true });
      records = Array.isArray(addr) ? addr : [{ address: addr.address || addr, family: addr.family }];
    } else {
      records = await dnsPromises.lookup(host, { all: true, verbatim: true });
    }
    if (!records || records.length === 0) {
      return deny('DNS_EMPTY', `DNS lookup returned no addresses for ${host}`);
    }
    for (const rec of records) {
      const address = typeof rec === 'string' ? rec : rec.address;
      const cls = classifyIp(address);
      if (config.block_metadata && cls.kind === 'link_local') {
        return deny(
          'BLOCKED_METADATA',
          `Host ${host} resolves to metadata/link-local address ${address}`
        );
      }
      const ipCheck = isIpAllowed(address);
      if (!ipCheck.ok) {
        return deny(
          ipCheck.reason,
          `Host ${host} resolves to blocked address ${address} (${ipCheck.reason})`
        );
      }
    }
    return { ok: true };
  } catch (e) {
    return deny('DNS_FAIL', `DNS lookup failed for ${host}: ${e.message}`);
  }
}

/**
 * @private
 */
function deny(reason, message) {
  try {
    const metrics = require('./metrics.js');
    metrics.inc('gingee_egress_denied_total', { reason: String(reason || 'UNKNOWN') });
  } catch (_) {
    /* metrics optional at load */
  }
  return {
    ok: false,
    code: 'EGRESS_DENIED',
    reason,
    message: message || reason
  };
}

/**
 * Max redirects for axios under current policy.
 * @returns {number}
 */
function getMaxRedirects() {
  if (config.mode === 'off') return 5;
  return config.max_redirects;
}

/**
 * Axios beforeRedirect hook: re-validate each hop (sync DNS via lookupSync).
 * @param {object} options - axios redirect options (has hostname, protocol, href, etc.)
 */
function beforeRedirect(options /*, responseDetails */) {
  if (config.mode === 'off') return;

  let nextUrl;
  if (options.href) {
    nextUrl = options.href;
  } else if (options.protocol && options.hostname) {
    const proto = options.protocol.endsWith(':') ? options.protocol : `${options.protocol}:`;
    const port = options.port ? `:${options.port}` : '';
    const pathPart = options.pathname || options.path || '/';
    nextUrl = `${proto}//${options.hostname}${port}${pathPart}`;
  } else {
    const err = new Error('EGRESS_DENIED: redirect target missing URL');
    err.code = 'EGRESS_DENIED';
    err.reason = 'REDIRECT_INVALID';
    throw err;
  }

  // Synchronous validation for axios hook (uses lookupSync when dns_check is on).
  let parsed;
  try {
    parsed = new URL(String(nextUrl));
  } catch (_) {
    const err = new Error(`EGRESS_DENIED: invalid redirect URL ${nextUrl}`);
    err.code = 'EGRESS_DENIED';
    err.reason = 'INVALID_URL';
    throw err;
  }

  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') {
    const err = new Error(`EGRESS_DENIED: redirect scheme ${protocol}`);
    err.code = 'EGRESS_DENIED';
    err.reason = 'SCHEME';
    throw err;
  }
  if (config.https_only && protocol !== 'https:') {
    const err = new Error('EGRESS_DENIED: redirect must be https');
    err.code = 'EGRESS_DENIED';
    err.reason = 'HTTPS_ONLY';
    throw err;
  }

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (config.block_metadata && isMetadataHost(host)) {
    const err = new Error(`EGRESS_DENIED: redirect metadata host ${host}`);
    err.code = 'EGRESS_DENIED';
    err.reason = 'BLOCKED_METADATA';
    throw err;
  }
  for (const d of config.deny_hosts) {
    if (hostMatchesPattern(host, d)) {
      const err = new Error(`EGRESS_DENIED: redirect deny host ${host}`);
      err.code = 'EGRESS_DENIED';
      err.reason = 'DENY_HOST';
      throw err;
    }
  }
  if (net.isIP(host)) {
    const ipCheck = isIpAllowed(host);
    if (!ipCheck.ok) {
      const err = new Error(`EGRESS_DENIED: redirect IP ${host} (${ipCheck.reason})`);
      err.code = 'EGRESS_DENIED';
      err.reason = ipCheck.reason;
      throw err;
    }
  } else if (config.mode === 'allowlist') {
    if (!config.allow_hosts.some((p) => hostMatchesPattern(host, p))) {
      const err = new Error(`EGRESS_DENIED: redirect host not allowlisted ${host}`);
      err.code = 'EGRESS_DENIED';
      err.reason = 'ALLOWLIST';
      throw err;
    }
  } else if (config.mode === 'protected' && config.dns_check) {
    try {
      const records = dns.lookupSync(host, { all: true, verbatim: true });
      const list = Array.isArray(records) ? records : [records];
      for (const rec of list) {
        const address = typeof rec === 'string' ? rec : rec.address;
        const ipCheck = isIpAllowed(address);
        if (!ipCheck.ok) {
          const err = new Error(
            `EGRESS_DENIED: redirect host ${host} → ${address} (${ipCheck.reason})`
          );
          err.code = 'EGRESS_DENIED';
          err.reason = ipCheck.reason;
          throw err;
        }
      }
    } catch (e) {
      if (e.code === 'EGRESS_DENIED') throw e;
      const err = new Error(`EGRESS_DENIED: redirect DNS fail ${host}: ${e.message}`);
      err.code = 'EGRESS_DENIED';
      err.reason = 'DNS_FAIL';
      throw err;
    }
  }
}

/**
 * Synchronous-ish helper for tests: classify without DNS.
 * @param {string} urlString
 * @returns {Promise<object>}
 */
async function assertUrlAllowedNoDns(urlString) {
  return assertUrlAllowed(urlString, { skipDns: true });
}

/** @private */
function _resetForTests() {
  config = {
    ...DEFAULTS,
    allow_hosts: [],
    allow_cidrs: [],
    deny_hosts: [],
    deny_cidrs: []
  };
  logger = null;
}

module.exports = {
  DEFAULTS,
  initServer,
  getConfig,
  classifyIp,
  assertUrlAllowed,
  assertUrlAllowedNoDns,
  getMaxRedirects,
  beforeRedirect,
  _resetForTests,
  /** @private test helpers */
  _isMetadataHost: isMetadataHost,
  _hostMatchesPattern: hostMatchesPattern
};
