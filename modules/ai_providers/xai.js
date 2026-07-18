/**
 * xAI (Grok) adapter — planned P1.
 *
 * Config (future):
 *   { "type": "xai", "api_key": "...", "default_model": "grok-2" }
 *
 * Will implement the same surface as mock/gemini:
 *   chat, chatStream, complete, parseDocument (if supported), moderate (if supported)
 *
 * @private
 */
class XaiAiAdapter {
  constructor(config, app, logger) {
    this.config = config || {};
    this.app = app;
    this.logger = logger;
    throw new Error(
      "AI provider 'xai' (Grok) is planned for P1 and is not implemented yet. Use type 'gemini' or 'mock'."
    );
  }
}

module.exports = XaiAiAdapter;
