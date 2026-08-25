const { getContext } = require("./gingee.js");
const secrets = require("./secrets.js");

/**
 * @module messaging
 * @description
 * Outbound messaging (SMS, MMS, WhatsApp, etc.) for Gingee apps using a provider adapter pattern (similar to `db`, `cache`, `email`, and `ai`).
 *
 * <b>Configuration (single config, no named profiles):</b>
 * - Optional server defaults: `gingee.json` → `messaging`
 * - Optional app config: `app.json` → `messaging` (overrides server for that app)
 * - Runtime override: {@link module:messaging.sendWithConfig} merges on top for one send only
 * - Twilio WhatsApp: set message `channel: 'whatsapp'` (optional config `whatsapp_from`); use `contentSid` / `contentVariables` for approved templates
 *
 * <b>Providers (v1):</b> `mock` / `console` (log only), `twilio` (Twilio Programmable Messaging — SMS/MMS/WhatsApp)
 *
 * <b>IMPORTANT:</b> Requires explicit permission to use the module (`messaging`). See docs/permissions-guide for more details.
 */

/** @type {Map<string, { adapter: object, config: object }>} */
const messagingInstances = new Map();

/** @type {object|null} */
let serverMessagingConfig = null;

/**
 * Shallow-merge messaging configs. Later sources win.
 * @private
 */
function mergeMessagingConfig(...parts) {
  const out = {};
  for (const part of parts) {
    if (part && typeof part === "object" && !Array.isArray(part)) {
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
  if (t === "log" || t === "logger" || t === "dev" || t === "console") {
    return "console";
  }
  if (t === "mock" || t === "test" || t === "fake") {
    return "mock";
  }
  if (t === "twilio" || t === "twilio_messaging" || t === "twillio") {
    return "twilio";
  }
  return t;
}

// Static requires so bundlers/tests resolve the same modules (dynamic path.join require bypasses Jest mocks).
const PROVIDERS = {
  mock: require("./messaging_providers/mock.js"),
  console: require("./messaging_providers/console.js"),
  twilio: require("./messaging_providers/twilio.js"),
};

/**
 * Build an adapter instance for a resolved config.
 * @private
 */
function createAdapter(config, app, logger) {
  const type = normalizeType(config && config.type);
  if (!type) {
    throw new Error(
      "Messaging config is missing 'type' (e.g. 'mock', 'console', or 'twilio').",
    );
  }

  const AdapterClass = PROVIDERS[type];
  if (!AdapterClass) {
    throw new Error(
      `Unknown messaging provider '${type}'. Supported: ${Object.keys(PROVIDERS).join(", ")}`,
    );
  }

  return new AdapterClass(config, app, logger);
}

/**
 * Normalize channel to wire value used by adapters (`sms` | `whatsapp`).
 * UI aliases like `mms` map to `sms` addressing (media still via mediaUrl).
 * @private
 */
function normalizeChannel(raw) {
  if (raw === undefined || raw === null || raw === "") return "sms";
  const c = String(raw).toLowerCase().trim();
  if (c === "whatsapp" || c === "wa") return "whatsapp";
  if (c === "sms" || c === "mms" || c === "text") return "sms";
  throw new Error(
    `Unsupported messaging channel '${raw}'. Use 'sms', 'mms', or 'whatsapp'.`,
  );
}

/**
 * Normalize Twilio Content Template variables to a plain object (or undefined).
 * @private
 */
function normalizeContentVariables(raw) {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
      throw new Error("contentVariables JSON must be an object");
    } catch (e) {
      throw new Error(
        `Invalid contentVariables JSON: ${e && e.message ? e.message : e}`,
      );
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return raw;
  }
  throw new Error("contentVariables must be an object or JSON object string.");
}

/**
 * Normalize app-facing message fields.
 * @private
 */
function normalizeMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("messaging.send requires a message object.");
  }

  const to = message.to || message.recipient || message.phone;
  if (!to || (Array.isArray(to) && to.length === 0)) {
    throw new Error("Messaging message requires a 'to' recipient.");
  }

  const body =
    message.body !== undefined && message.body !== null
      ? String(message.body)
      : message.text !== undefined && message.text !== null
        ? String(message.text)
        : message.message !== undefined && message.message !== null
          ? String(message.message)
          : "";

  const mediaUrl =
    message.mediaUrl ||
    message.media_url ||
    message.mediaUrls ||
    message.media_urls ||
    message.media;
  const hasMedia =
    mediaUrl && (!Array.isArray(mediaUrl) || mediaUrl.length > 0);

  const contentSid =
    message.contentSid || message.content_sid
      ? String(message.contentSid || message.content_sid).trim()
      : "";
  const contentVariables = normalizeContentVariables(
    message.contentVariables !== undefined
      ? message.contentVariables
      : message.content_variables,
  );

  const channel = normalizeChannel(message.channel);

  if (!body && !hasMedia && !contentSid) {
    throw new Error(
      "Messaging message requires 'body' (or 'text'), 'mediaUrl', and/or 'contentSid'.",
    );
  }

  return {
    to,
    body,
    channel,
    from:
      message.from ||
      message.from_number ||
      message.fromNumber ||
      message.sender,
    messagingServiceSid:
      message.messagingServiceSid || message.messaging_service_sid,
    mediaUrl: mediaUrl
      ? Array.isArray(mediaUrl)
        ? mediaUrl
        : [mediaUrl]
      : undefined,
    statusCallback: message.statusCallback || message.status_callback,
    contentSid: contentSid || undefined,
    contentVariables,
  };
}

/**
 * Stores server-wide messaging defaults from gingee.json (may be empty).
 * Called once at process boot.
 * @private
 */
function initServer(messagingConfig, logger) {
  serverMessagingConfig =
    messagingConfig &&
    typeof messagingConfig === "object" &&
    !Array.isArray(messagingConfig)
      ? { ...messagingConfig }
      : null;
  if (serverMessagingConfig && serverMessagingConfig.type) {
    logger.info(
      `[messaging] Server default messaging provider: '${normalizeType(serverMessagingConfig.type)}'`,
    );
  } else {
    logger.info(
      "[messaging] No server-level messaging config; apps may set app.json messaging or use sendWithConfig.",
    );
  }
}

/**
 * Resolves merged config for an app (server ← app) and initializes its default adapter.
 * @private
 */
function initApp(app, logger) {
  if (!app || !app.name) {
    throw new Error("messaging.initApp requires an app with a name.");
  }

  const appConfig =
    app.config &&
    app.config.messaging &&
    typeof app.config.messaging === "object" &&
    !Array.isArray(app.config.messaging)
      ? app.config.messaging
      : null;

  const merged = mergeMessagingConfig(serverMessagingConfig, appConfig);
  if (!merged.type) {
    // No messaging configured for this app — that is OK until send() is called.
    messagingInstances.delete(app.name);
    logger.info(
      `[messaging] App '${app.name}' has no messaging type configured (server or app.json).`,
    );
    return;
  }

  try {
    const adapter = createAdapter(merged, app, logger);
    messagingInstances.set(app.name, { adapter, config: merged });
    logger.info(
      `[messaging] Initialized messaging for app '${app.name}' with provider '${normalizeType(merged.type)}'`,
    );
  } catch (e) {
    messagingInstances.delete(app.name);
    logger.error(
      `[messaging] Failed to init messaging for app '${app.name}': ${e.message}`,
    );
    throw e;
  }
}

/**
 * @private
 */
async function shutdownApp(appName, logger) {
  const entry = messagingInstances.get(appName);
  if (!entry) return;
  try {
    if (entry.adapter && typeof entry.adapter.shutdown === "function") {
      await entry.adapter.shutdown();
    }
  } catch (err) {
    if (logger)
      logger.error(
        `[messaging] Error shutting down messaging for '${appName}': ${err.message}`,
      );
  }
  messagingInstances.delete(appName);
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
  if (!appName)
    throw new Error("Messaging module cannot determine app context.");
  let entry = messagingInstances.get(appName);

  // Lazy init support for isolated workers or late config
  if (!entry || !entry.adapter) {
    const base = mergeMessagingConfig(
      serverMessagingConfig,
      app && app.config && app.config.messaging,
    );
    if (base && normalizeType(base.type)) {
      try {
        initApp(
          app || { name: appName, config: { messaging: base } },
          logger || console,
        );
        entry = messagingInstances.get(appName);
      } catch (_) {
        /* let error throw below if entry still missing */
      }
    }
  }

  return { appName, app, logger, entry };
}

/**
 * @function send
 * @memberof module:messaging
 * @description Sends a message using the app's resolved config (app.json overrides gingee.json).
 * @param {object} message - Outbound message.
 * @param {string|Array<string>} message.to - Recipient phone number(s) (e.g. '+1234567890').
 * @param {string} [message.body] - Text body of the message (can also use message.text).
 * @param {string} [message.text] - Plain text body alias.
 * @param {string} [message.channel='sms'] - `'sms'` (default; also `'mms'`) or `'whatsapp'`.
 * @param {string} [message.from] - Override default sender number for this message only.
 * @param {string} [message.messagingServiceSid] - Twilio Messaging Service SID override.
 * @param {string|Array<string>} [message.mediaUrl] - URL(s) for MMS / WhatsApp media attachments.
 * @param {string} [message.contentSid] - Twilio Content Template SID (WhatsApp / rich templates).
 * @param {object|string} [message.contentVariables] - Template variables object (or JSON string).
 * @param {string} [message.statusCallback] - Webhook callback URL for delivery status updates.
 * @returns {Promise<object>} Result with messageId, provider, status, etc.
 * @example
 * const messaging = require('messaging');
 * await messaging.send({
 *   to: '+1234567890',
 *   body: 'Your verification code is 123456.'
 * });
 * // WhatsApp freeform (within 24h session) or Content Template:
 * await messaging.send({
 *   channel: 'whatsapp',
 *   to: '+1234567890',
 *   contentSid: 'HXxxxxxxxx',
 *   contentVariables: { '1': 'Ada' }
 * });
 */
async function send(message) {
  const { appName, entry } = _getAppEntry();
  if (!entry || !entry.adapter) {
    throw new Error(
      `No messaging configuration for app '${appName}'. Set messaging in app.json or gingee.json, or use messaging.sendWithConfig().`,
    );
  }
  const normalized = normalizeMessage(message);
  return entry.adapter.send(normalized);
}

/**
 * @function sendWithConfig
 * @memberof module:messaging
 * @description Sends a single message using a runtime config that overrides both server and app.json
 * settings for this transaction only. Does not persist or change the app's default adapter.
 * @param {object} configOverride - Partial or full messaging config (type, account_sid, auth_token, from, etc.).
 * @param {object} message - Same shape as {@link module:messaging.send}.
 * @returns {Promise<object>} Result with messageId, provider, status, etc.
 * @example
 * const messaging = require('messaging');
 * await messaging.sendWithConfig(
 *   { type: 'twilio', account_sid: 'ACxxx', auth_token: 'auth_xxx', from: '+19876543210' },
 *   { to: '+1234567890', body: 'One-off notification' }
 * );
 */
async function sendWithConfig(configOverride, message) {
  const { appName, app, logger, entry } = _getAppEntry();
  if (
    !configOverride ||
    typeof configOverride !== "object" ||
    Array.isArray(configOverride)
  ) {
    throw new Error(
      "messaging.sendWithConfig requires a config object as the first argument.",
    );
  }

  const baseConfig =
    (entry && entry.config) ||
    mergeMessagingConfig(
      serverMessagingConfig,
      app && app.config && app.config.messaging,
    );

  // Allow env:/file: refs in runtime overrides (resolved by engine).
  const effective = mergeMessagingConfig(
    baseConfig,
    secrets.resolveDeep(configOverride),
  );

  if (!normalizeType(effective.type)) {
    throw new Error(
      "messaging.sendWithConfig: resolved config has no 'type'.",
    );
  }

  const adapter = createAdapter(
    effective,
    app || { name: appName },
    logger || console,
  );
  const normalized = normalizeMessage(message);
  try {
    return await adapter.send(normalized);
  } finally {
    if (typeof adapter.shutdown === "function") {
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

  // Engine lifecycle
  initServer,
  initApp,
  shutdownApp,
  reinitApp,

  // Test helpers
  _mergeMessagingConfig: mergeMessagingConfig,
  _normalizeMessage: normalizeMessage,
  _normalizeChannel: normalizeChannel,
  _getServerConfig: () => serverMessagingConfig,
  _resetForTests: () => {
    messagingInstances.clear();
    serverMessagingConfig = null;
  },
};
