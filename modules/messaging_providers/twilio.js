/**
 * Twilio Programmable Messaging adapter (SMS, MMS, WhatsApp).
 * @private
 */

/**
 * Prefix WhatsApp scheme when channel is whatsapp; leave existing whatsapp: alone.
 * @param {string} address
 * @param {string} channel
 * @returns {string}
 */
function formatAddress(address, channel) {
  if (address === undefined || address === null) return address;
  const s = String(address).trim();
  if (!s) return s;
  if (channel !== "whatsapp") return s;
  if (/^whatsapp:/i.test(s)) return s;
  return `whatsapp:${s}`;
}

class TwilioMessagingAdapter {
  /**
   * @param {object} config - Messaging config ({ type, account_sid, auth_token, from, whatsapp_from, messaging_service_sid, ... }).
   * @param {object} app - Gingee app object.
   * @param {object} logger - Winston-style logger.
   */
  constructor(config, app, logger) {
    this.config = config || {};
    this.app = app;
    this.logger = logger;

    const accountSid =
      this.config.account_sid || this.config.accountSid || this.config.sid;
    const authToken =
      this.config.auth_token || this.config.authToken || this.config.token;
    const apiKey = this.config.api_key || this.config.apiKey;
    const apiSecret = this.config.api_secret || this.config.apiSecret;

    if (!accountSid) {
      throw new Error("Twilio messaging config is missing 'account_sid'.");
    }
    if (!authToken && (!apiKey || !apiSecret)) {
      throw new Error(
        "Twilio messaging config is missing 'auth_token' (or 'api_key' and 'api_secret').",
      );
    }

    const { loadOptional } = require("../internal_utils.js");
    const twilio = loadOptional(
      () => require("twilio"),
      "twilio",
      "Twilio messaging provider",
    );

    if (apiKey && apiSecret) {
      this._client = twilio(apiKey, apiSecret, { accountSid });
    } else {
      this._client = twilio(accountSid, authToken);
    }
  }

  /**
   * Resolve From for this send (WhatsApp prefers whatsapp_from when set).
   * @private
   */
  _resolveFrom(message, channel) {
    if (message.from) return message.from;
    if (channel === "whatsapp") {
      const waFrom =
        this.config.whatsapp_from ||
        this.config.whatsappFrom ||
        this.config.whatsapp_number ||
        this.config.whatsappNumber;
      if (waFrom) return waFrom;
    }
    return (
      this.config.from ||
      this.config.from_number ||
      this.config.fromNumber
    );
  }

  /**
   * @param {object} message - Normalized outbound message.
   * @returns {Promise<object>} Result with messageId, provider, status, etc.
   */
  async send(message) {
    const channel = message.channel || "sms";
    const from = this._resolveFrom(message, channel);
    const messagingServiceSid =
      message.messagingServiceSid ||
      message.messaging_service_sid ||
      this.config.messaging_service_sid ||
      this.config.messagingServiceSid;

    if (!from && !messagingServiceSid) {
      throw new Error(
        "Messaging 'from' number or 'messagingServiceSid' is required (set in config or on the message). For WhatsApp, set 'whatsapp_from' or 'from' to your Twilio WhatsApp sender.",
      );
    }

    const toList = Array.isArray(message.to) ? message.to : [message.to];
    const sendOne = async (recipient) => {
      const payload = {
        to: formatAddress(recipient, channel),
      };

      if (messagingServiceSid) {
        payload.messagingServiceSid = messagingServiceSid;
      } else if (from) {
        payload.from = formatAddress(from, channel);
      }

      // Content templates (WhatsApp business-initiated / rich messages)
      if (message.contentSid) {
        payload.contentSid = message.contentSid;
        if (
          message.contentVariables &&
          typeof message.contentVariables === "object"
        ) {
          payload.contentVariables = JSON.stringify(message.contentVariables);
        }
      }

      // Freeform body — still useful inside 24h WhatsApp sessions / SMS / MMS
      if (message.body) {
        payload.body = message.body;
      }

      if (message.mediaUrl) {
        payload.mediaUrl = Array.isArray(message.mediaUrl)
          ? message.mediaUrl
          : [message.mediaUrl];
      }
      const statusCallback =
        message.statusCallback ||
        message.status_callback ||
        this.config.status_callback ||
        this.config.statusCallback;
      if (statusCallback) {
        payload.statusCallback = statusCallback;
      }

      const response = await this._client.messages.create(payload);
      return {
        messageId:
          response && response.sid
            ? String(response.sid)
            : `twilio-${Date.now()}`,
        provider: "twilio",
        channel,
        status: response && response.status ? response.status : "sent",
        sid: response && response.sid,
        to: response && response.to,
        from: response && response.from,
        dateCreated: response && response.dateCreated,
        numSegments: response && response.numSegments,
        price: response && response.price,
        priceUnit: response && response.priceUnit,
        contentSid: message.contentSid,
      };
    };

    try {
      if (toList.length === 1) {
        return await sendOne(toList[0]);
      }
      const results = await Promise.all(toList.map(sendOne));
      return {
        messageId: results.map((r) => r.messageId).join(","),
        provider: "twilio",
        channel,
        status: "sent",
        results,
      };
    } catch (err) {
      const detail = err && err.message ? err.message : String(err);
      this.logger.error(
        `[messaging:twilio] Send failed for app '${this.app && this.app.name}': ${detail}`,
      );
      throw new Error(`Twilio messaging send failed: ${detail}`);
    }
  }

  async shutdown() {
    // SDK has no connection pool to close
  }
}

module.exports = TwilioMessagingAdapter;
module.exports.formatAddress = formatAddress;
