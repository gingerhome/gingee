/**
 * Deterministic mock AI provider for local development and tests.
 * @private
 */
class MockAiAdapter {
  constructor(config, app, logger) {
    this.config = config || {};
    this.app = app;
    this.logger = logger;
    this.model = this.config.default_model || 'mock-model';
  }

  async chat(request) {
    const text = _mockReply(request);
    return {
      text,
      message: { role: 'assistant', content: text },
      model: request.model || this.model,
      provider: 'mock',
      usage: { inputTokens: 0, outputTokens: text.length },
      finishReason: 'stop'
    };
  }

  async *chatStream(request) {
    const full = _mockReply(request);
    const parts = full.match(/.{1,12}/g) || [full];
    for (const part of parts) {
      yield {
        textDelta: part,
        model: request.model || this.model,
        provider: 'mock',
        done: false
      };
    }
    yield {
      textDelta: '',
      text: full,
      model: request.model || this.model,
      provider: 'mock',
      done: true,
      usage: { inputTokens: 0, outputTokens: full.length },
      finishReason: 'stop'
    };
  }

  async complete(request) {
    return this.chat({
      messages: [{ role: 'user', content: request.prompt || '' }],
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens
    });
  }

  async parseDocument(request) {
    const name =
      (request.source && (request.source.path || request.source.name)) ||
      request.mime ||
      'document';
    const mode = request.mode || 'extract';
    const text = `[mock:${mode}] Parsed content from ${name}. ${request.instruction || ''}`.trim();
    return {
      text,
      provider: 'mock',
      model: request.model || this.model,
      mode,
      usage: { inputTokens: 0, outputTokens: text.length }
    };
  }

  async moderate(request) {
    const text = String(request.text || '');
    const flagged = /\b(BLOCK_ME|HATE_SPEECH_TEST)\b/i.test(text);
    return {
      flagged,
      categories: flagged ? { mock_block: true } : {},
      provider: 'mock',
      scores: {}
    };
  }

  async shutdown() {}
}

function _mockReply(request) {
  const messages = request.messages || [];
  const last = messages[messages.length - 1];
  let userText = '';
  if (last) {
    if (typeof last.content === 'string') userText = last.content;
    else if (Array.isArray(last.content)) {
      userText = last.content
        .filter((p) => p && p.type === 'text')
        .map((p) => p.text)
        .join(' ');
    }
  }
  const hasImage = messages.some(
    (m) =>
      Array.isArray(m.content) && m.content.some((p) => p && (p.type === 'image' || p.type === 'file'))
  );
  const prefix = hasImage ? '[mock-vision] ' : '[mock] ';
  return `${prefix}Echo: ${userText || '(empty)'}`.slice(0, 2000);
}

module.exports = MockAiAdapter;
