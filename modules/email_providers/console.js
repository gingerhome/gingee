/**
 * Dev / no-op email adapter: logs the message and reports success without sending.
 * @private
 */
class ConsoleEmailAdapter {
  /**
   * @param {object} config - Email config ({ type, from, from_name, ... }).
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
   * @returns {Promise<{ messageId: string, provider: string, status: string }>}
   */
  async send(message) {
    const messageId = `console-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    this.logger.info('[email:console] Outbound email (not sent)', {
      messageId,
      app: this.app && this.app.name,
      to: message.to,
      cc: message.cc,
      bcc: message.bcc,
      from: message.from,
      fromName: message.fromName,
      subject: message.subject,
      hasText: !!message.text,
      hasHtml: !!message.html,
      attachmentCount: Array.isArray(message.attachments) ? message.attachments.length : 0
    });

    return {
      messageId,
      provider: 'console',
      status: 'logged'
    };
  }

  async shutdown() {
    // nothing to close
  }
}

module.exports = ConsoleEmailAdapter;
