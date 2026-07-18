const { getContext } = require('./gingee.js');
const secrets = require('./secrets.js');

/**
 * @module email
 * @description
 * Transactional email for Gingee apps using a provider adapter pattern (similar to `db` / `cache`).
 *
 * <b>Configuration (single config, no named profiles):</b>
 * - Optional server defaults: `gingee.json` → `email`
 * - Optional app config: `app.json` → `email` (overrides server for that app)
 * - Runtime override: {@link module:email.sendWithConfig} merges on top for one send only
 *
 * <b>Providers (v1):</b> `console` (log only), `sendgrid` (@sendgrid/mail)
 *
 * <b>IMPORTANT:</b> Requires explicit permission to use the module. See docs/permissions-guide for more details.
 */

/** @type {Map<string, { adapter: object, config: object }>} */
const emailInstances = new Map();

/** @type {object|null} */
let serverEmailConfig = null;

/**
 * Shallow-merge email configs. Later sources win.
 * @private
 */
function mergeEmailConfig(...parts) {
  const out = {};
  for (const part of parts) {
    if (part && typeof part === 'object' && !Array.isArray(part)) {
      Object.assign(out, part);
    }
  }
  return out;
}

/**
 * Normalize provider type aliases.
 * @private
 */
function normalizeType(type) {
  if (!type) return null;
  const t = String(type).toLowerCase();
  if (t === 'log' || t === 'logger' || t === 'dev') return 'console';
  return t;
}

// Static requires so bundlers/tests resolve the same modules (dynamic path.join require bypasses Jest mocks).
const PROVIDERS = {
  console: require('./email_providers/console.js'),
  sendgrid: require('./email_providers/sendgrid.js')
};

/**
 * Build an adapter instance for a resolved config.
 * @private
 */
function createAdapter(config, app, logger) {
  const type = normalizeType(config && config.type);
  if (!type) {
    throw new Error("Email config is missing 'type' (e.g. 'sendgrid' or 'console').");
  }

  const AdapterClass = PROVIDERS[type];
  if (!AdapterClass) {
    throw new Error(`Unknown email provider '${type}'. Supported: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  return new AdapterClass(config, app, logger);
}

/**
 * Normalize app-facing message fields.
 * @private
 */
function normalizeMessage(message) {
  if (!message || typeof message !== 'object') {
    throw new Error('email.send requires a message object.');
  }

  const to = message.to;
  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error("Email message requires a 'to' address.");
  }
  if (!message.subject || String(message.subject).trim() === '') {
    throw new Error("Email message requires a 'subject'.");
  }
  if (!message.text && !message.html) {
    throw new Error("Email message requires 'text' and/or 'html' body.");
  }

  return {
    to,
    subject: String(message.subject),
    text: message.text,
    html: message.html,
    from: message.from || message.from_email,
    fromName: message.fromName || message.from_name,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo || message.reply_to,
    attachments: message.attachments
  };
}

/**
 * Stores server-wide email defaults from gingee.json (may be empty).
 * Called once at process boot.
 * @private
 */
function initServer(emailConfig, logger) {
  serverEmailConfig =
    emailConfig && typeof emailConfig === 'object' && !Array.isArray(emailConfig)
      ? { ...emailConfig }
      : null;
  if (serverEmailConfig && serverEmailConfig.type) {
    logger.info(`[email] Server default email provider: '${normalizeType(serverEmailConfig.type)}'`);
  } else {
    logger.info('[email] No server-level email config; apps may set app.json email or use sendWithConfig.');
  }
}

/**
 * Resolves merged config for an app (server ← app) and initializes its default adapter.
 * @private
 */
function initApp(app, logger) {
  if (!app || !app.name) {
    throw new Error('email.initApp requires an app with a name.');
  }

  const appConfig =
    app.config && app.config.email && typeof app.config.email === 'object' && !Array.isArray(app.config.email)
      ? app.config.email
      : null;

  const merged = mergeEmailConfig(serverEmailConfig, appConfig);
  if (!merged.type) {
    // No email configured for this app — that is OK until send() is called.
    emailInstances.delete(app.name);
    logger.info(`[email] App '${app.name}' has no email type configured (server or app.json).`);
    return;
  }

  try {
    const adapter = createAdapter(merged, app, logger);
    emailInstances.set(app.name, { adapter, config: merged });
    logger.info(`[email] Initialized email for app '${app.name}' with provider '${normalizeType(merged.type)}'`);
  } catch (e) {
    emailInstances.delete(app.name);
    logger.error(`[email] Failed to init email for app '${app.name}': ${e.message}`);
    throw e;
  }
}

/**
 * @private
 */
async function shutdownApp(appName, logger) {
  const entry = emailInstances.get(appName);
  if (!entry) return;
  try {
    if (entry.adapter && typeof entry.adapter.shutdown === 'function') {
      await entry.adapter.shutdown();
    }
  } catch (err) {
    if (logger) logger.error(`[email] Error shutting down email for '${appName}': ${err.message}`);
  }
  emailInstances.delete(appName);
}

/**
 * @private
 */
async function reinitApp(appName, app, logger) {
  await shutdownApp(appName, logger);
  initApp(app, logger);
}

/**
 * @private
 */
function _getAppEntry() {
  const { appName, app, logger } = getContext();
  if (!appName) throw new Error('Email module cannot determine app context.');
  return { appName, app, logger, entry: emailInstances.get(appName) };
}

/**
 * @function send
 * @memberof module:email
 * @description Sends an email using the app's resolved config (app.json overrides gingee.json).
 * @param {object} message - Outbound message.
 * @param {string|Array<string>} message.to - Recipient(s).
 * @param {string} message.subject - Subject line.
 * @param {string} [message.text] - Plain-text body.
 * @param {string} [message.html] - HTML body.
 * @param {string} [message.from] - Override default from address for this message only.
 * @param {string} [message.fromName] - Override default from name.
 * @param {string|Array<string>} [message.cc]
 * @param {string|Array<string>} [message.bcc]
 * @param {string} [message.replyTo]
 * @param {Array<object>} [message.attachments] - filename, content (Buffer or base64), type, disposition
 * @returns {Promise<object>} Result with messageId, provider, status
 * @example
 * const email = require('email');
 * await email.send({
 *   to: 'user@example.com',
 *   subject: 'Welcome',
 *   text: 'Thanks for joining.',
 *   html: '<p>Thanks for joining.</p>'
 * });
 */
async function send(message) {
  const { appName, entry } = _getAppEntry();
  if (!entry || !entry.adapter) {
    throw new Error(
      `No email configuration for app '${appName}'. Set email in app.json or gingee.json, or use email.sendWithConfig().`
    );
  }
  const normalized = normalizeMessage(message);
  return entry.adapter.send(normalized);
}

/**
 * @function sendWithConfig
 * @memberof module:email
 * @description Sends a single email using a runtime config that overrides both server and app.json
 * settings for this transaction only. Does not persist or change the app's default adapter.
 * @param {object} configOverride - Partial or full email config (type, api_key, from, from_name, etc.).
 * @param {object} message - Same shape as {@link module:email.send}.
 * @returns {Promise<object>} Result with messageId, provider, status
 * @example
 * const email = require('email');
 * await email.sendWithConfig(
 *   { type: 'sendgrid', api_key: userApiKey, from: 'billing@example.com' },
 *   { to: 'customer@example.com', subject: 'Invoice', text: 'Your invoice is attached.' }
 * );
 */
async function sendWithConfig(configOverride, message) {
  const { appName, app, logger, entry } = _getAppEntry();
  if (!configOverride || typeof configOverride !== 'object' || Array.isArray(configOverride)) {
    throw new Error('email.sendWithConfig requires a config object as the first argument.');
  }

  const baseConfig = (entry && entry.config) || mergeEmailConfig(serverEmailConfig, app && app.config && app.config.email);
  // Allow env:/file: refs in runtime overrides (resolved by engine, not app process.env access).
  const effective = mergeEmailConfig(baseConfig, secrets.resolveDeep(configOverride));

  if (!normalizeType(effective.type)) {
    throw new Error("email.sendWithConfig: resolved config has no 'type'.");
  }

  const adapter = createAdapter(effective, app || { name: appName }, logger || console);
  const normalized = normalizeMessage(message);
  try {
    return await adapter.send(normalized);
  } finally {
    if (typeof adapter.shutdown === 'function') {
      try {
        await adapter.shutdown();
      } catch (_) {
        /* ignore */
      }
    }
  }
}

module.exports = {
  // Public app API
  send,
  sendWithConfig,

  // Engine lifecycle (not for sandboxed app scripts — blocked as normal module export surface is app-facing;
  // host requires this file and calls these. Apps only get send/sendWithConfig via the same export;
  // that is OK — initApp is useless without host app object and is not documented for apps.)
  initServer,
  initApp,
  shutdownApp,
  reinitApp,

  // Test helpers
  _mergeEmailConfig: mergeEmailConfig,
  _getServerConfig: () => serverEmailConfig,
  _resetForTests: () => {
    emailInstances.clear();
    serverEmailConfig = null;
  }
};
