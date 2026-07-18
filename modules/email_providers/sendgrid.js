/**
 * SendGrid transactional email adapter.
 * @private
 */
class SendGridEmailAdapter {
  /**
   * @param {object} config - Email config ({ type, api_key, from, from_name, ... }).
   * @param {object} app - Gingee app object.
   * @param {object} logger - Winston-style logger.
   */
  constructor(config, app, logger) {
    this.config = config || {};
    this.app = app;
    this.logger = logger;

    const apiKey = this.config.api_key || this.config.apiKey;
    if (!apiKey) {
      throw new Error("SendGrid email config is missing 'api_key'.");
    }
    if (!this.config.from && !this.config.from_email) {
      // from may still be supplied per message; warn only
      this.logger.warn(
        `[email:sendgrid] App '${app && app.name}' has no default 'from' address; each send must supply from.`
      );
    }

    // Lazy-require so console-only installs still load the module graph in tests without network.
    const sgMail = require('@sendgrid/mail');
    // Use a dedicated client instance shape: setApiKey is process-global on the default export.
    // That is acceptable for single-key apps; sendWithConfig creates a fresh adapter and re-sets the key.
    this._sgMail = sgMail;
    this._apiKey = apiKey;
    this._sgMail.setApiKey(apiKey);
  }

  /**
   * @param {object} message - Normalized outbound message.
   * @returns {Promise<{ messageId: string, provider: string, status: string }>}
   */
  async send(message) {
    // Ensure this adapter's key is active (important when multiple apps / runtime overrides share the process).
    this._sgMail.setApiKey(this._apiKey);

    const fromEmail = message.from || this.config.from || this.config.from_email;
    if (!fromEmail) {
      throw new Error("Email 'from' address is required (set in config or on the message).");
    }

    const fromName = message.fromName || message.from_name || this.config.from_name || this.config.fromName;
    const from = fromName ? { email: fromEmail, name: fromName } : fromEmail;

    const msg = {
      to: message.to,
      from,
      subject: message.subject,
      text: message.text,
      html: message.html,
      cc: message.cc,
      bcc: message.bcc,
      replyTo: message.replyTo || message.reply_to,
      attachments: _mapAttachments(message.attachments)
    };

    // Strip undefined keys so SendGrid does not reject empty fields.
    Object.keys(msg).forEach((k) => {
      if (msg[k] === undefined || msg[k] === null) delete msg[k];
    });

    try {
      const [response] = await this._sgMail.send(msg);
      const messageId =
        (response && response.headers && (response.headers['x-message-id'] || response.headers['X-Message-Id'])) ||
        `sendgrid-${Date.now()}`;

      return {
        messageId: String(messageId),
        provider: 'sendgrid',
        status: 'sent',
        statusCode: response && response.statusCode
      };
    } catch (err) {
      const detail =
        err.response && err.response.body
          ? JSON.stringify(err.response.body)
          : err.message;
      this.logger.error(`[email:sendgrid] Send failed for app '${this.app && this.app.name}': ${detail}`);
      throw new Error(`SendGrid email send failed: ${err.message}`);
    }
  }

  async shutdown() {
    // SDK has no connection pool to close
  }
}

function _mapAttachments(attachments) {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return undefined;
  }
  return attachments.map((a) => {
    let content = a.content;
    if (Buffer.isBuffer(content)) {
      content = content.toString('base64');
    }
    return {
      content,
      filename: a.filename || a.fileName || 'attachment',
      type: a.type || a.contentType || a.mimeType,
      disposition: a.disposition || 'attachment',
      contentId: a.contentId || a.content_id
    };
  });
}

module.exports = SendGridEmailAdapter;
