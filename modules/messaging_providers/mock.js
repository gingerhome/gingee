/**
 * Deterministic mock messaging provider for local development and tests.
 * Logs the message and returns mock delivery details without sending over the network.
 * @private
 */
class MockMessagingAdapter {
  /**
   * @param {object} config - Messaging config ({ type, from, from_number, messaging_service_sid, ... }).
   * @param {object} app - Gingee app object.
   * @param {object} logger - Winston-style logger.
   */
  constructor(config, app, logger) {
    this.config = config || {};
    this.app = app;
    this.logger = logger;
  }

  /**
   * @param {object} message - Normalized outbound message.
   * @returns {Promise<object>}
   */
  async send(message) {
    const messageId = `mock-msg-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const from =
      message.from ||
      this.config.from ||
      this.config.from_number ||
      this.config.fromNumber;
    const messagingServiceSid =
      message.messagingServiceSid ||
      this.config.messaging_service_sid ||
      this.config.messagingServiceSid;

    const channel = message.channel || "sms";

    this.logger.info("[messaging:mock] Outbound message (not sent)", {
      messageId,
      app: this.app && this.app.name,
      channel,
      to: message.to,
      from,
      messagingServiceSid,
      body: message.body,
      mediaUrl: message.mediaUrl,
      contentSid: message.contentSid,
      contentVariables: message.contentVariables,
      statusCallback:
        message.statusCallback ||
        this.config.status_callback ||
        this.config.statusCallback,
    });

    return {
      messageId,
      provider: "mock",
      channel,
      status: "logged",
      to: message.to,
      from: from || messagingServiceSid || "mock-sender",
      body: message.body,
      mediaUrl: message.mediaUrl,
      contentSid: message.contentSid,
      contentVariables: message.contentVariables,
    };
  }

  async shutdown() {
    // nothing to close
  }
}

module.exports = MockMessagingAdapter;
