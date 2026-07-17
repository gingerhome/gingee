const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Google Gemini adapter for the Gingee `ai` module.
 * @private
 */
class GeminiAiAdapter {
  constructor(config, app, logger) {
    this.config = config || {};
    this.app = app;
    this.logger = logger;

    const apiKey = this.config.api_key || this.config.apiKey;
    if (!apiKey) {
      throw new Error("Gemini AI config is missing 'api_key'.");
    }

    this._genAI = new GoogleGenerativeAI(apiKey);
    this.defaultModel = this.config.default_model || this.config.model || 'gemini-2.0-flash';
    this.defaultVisionModel =
      this.config.default_vision_model || this.config.vision_model || this.defaultModel;
    this.maxOutputTokens = this.config.max_output_tokens || this.config.maxOutputTokens || 4096;
    this.timeoutMs = this.config.timeout_ms || this.config.timeoutMs || 60000;
  }

  _modelId(request, { vision = false } = {}) {
    return (
      request.model ||
      (vision ? this.defaultVisionModel : this.defaultModel)
    );
  }

  _getModel(modelId, generationConfig, safetySettings) {
    return this._genAI.getGenerativeModel({
      model: modelId,
      generationConfig,
      safetySettings
    });
  }

  _generationConfig(request) {
    const cfg = {
      maxOutputTokens: request.maxTokens || request.max_tokens || this.maxOutputTokens,
      temperature:
        request.temperature !== undefined && request.temperature !== null
          ? request.temperature
          : this.config.temperature
    };
    if (cfg.temperature === undefined) delete cfg.temperature;
    return cfg;
  }

  /**
   * Map optional Gingee safety config to Gemini safety settings.
   * When safety.enabled, use stricter BLOCK thresholds.
   */
  _safetySettings() {
    const safety = this.config.safety || {};
    if (!safety.enabled) return undefined;
    const threshold = safety.threshold || 'BLOCK_MEDIUM_AND_ABOVE';
    const categories = [
      'HARM_CATEGORY_HARASSMENT',
      'HARM_CATEGORY_HATE_SPEECH',
      'HARM_CATEGORY_SEXUALLY_EXPLICIT',
      'HARM_CATEGORY_DANGEROUS_CONTENT'
    ];
    return categories.map((category) => ({ category, threshold }));
  }

  async chat(request) {
    const prepared = _prepareGeminiChat(request);
    const modelId = this._modelId(request, { vision: prepared.hasVision });
    const model = this._getModel(modelId, this._generationConfig(request), this._safetySettings());

    try {
      const result = await model.generateContent({
        contents: prepared.contents,
        systemInstruction: prepared.systemInstruction || undefined
      });
      return _mapGeminiResponse(result, modelId, 'gemini');
    } catch (err) {
      this.logger.error(`[ai:gemini] chat failed: ${err.message}`);
      throw new Error(`Gemini chat failed: ${err.message}`);
    }
  }

  async *chatStream(request) {
    const prepared = _prepareGeminiChat(request);
    const modelId = this._modelId(request, { vision: prepared.hasVision });
    const model = this._getModel(modelId, this._generationConfig(request), this._safetySettings());

    let full = '';
    try {
      const streaming = await model.generateContentStream({
        contents: prepared.contents,
        systemInstruction: prepared.systemInstruction || undefined
      });

      for await (const chunk of streaming.stream) {
        let delta = '';
        try {
          delta = typeof chunk.text === 'function' ? chunk.text() : '';
        } catch (_) {
          delta = '';
        }
        if (delta) {
          full += delta;
          yield {
            textDelta: delta,
            model: modelId,
            provider: 'gemini',
            done: false
          };
        }
      }

      let usage = { inputTokens: 0, outputTokens: 0 };
      let finishReason = 'stop';
      try {
        const agg = await streaming.response;
        const mapped = _mapGeminiResponse({ response: agg }, modelId, 'gemini');
        usage = mapped.usage;
        finishReason = mapped.finishReason;
        if (!full && mapped.text) full = mapped.text;
      } catch (_) {
        /* ignore aggregate errors if stream already produced text */
      }

      yield {
        textDelta: '',
        text: full,
        model: modelId,
        provider: 'gemini',
        done: true,
        usage,
        finishReason
      };
    } catch (err) {
      this.logger.error(`[ai:gemini] chatStream failed: ${err.message}`);
      throw new Error(`Gemini chat stream failed: ${err.message}`);
    }
  }

  async complete(request) {
    return this.chat({
      messages: [{ role: 'user', content: request.prompt || '' }],
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens || request.max_tokens
    });
  }

  async parseDocument(request) {
    const source = request.source || {};
    const mime = request.mime || source.mime || 'application/octet-stream';
    const mode = request.mode || 'extract';
    const instruction =
      request.instruction ||
      (mode === 'ocr'
        ? 'Extract all text from this document via OCR. Return plain text only.'
        : mode === 'summarize'
          ? 'Summarize this document clearly and concisely.'
          : 'Extract the full readable text content from this document.');

    let parts = [{ text: instruction }];

    if (source.kind === 'buffer' || source.data) {
      const data = source.data || source.buffer;
      const b64 = Buffer.isBuffer(data) ? data.toString('base64') : String(data);
      parts.push({ inlineData: { data: b64, mimeType: mime } });
    } else if (source.kind === 'text' && source.text) {
      parts = [
        {
          text: `${instruction}\n\n--- Document text ---\n${source.text}`
        }
      ];
    } else {
      throw new Error(
        "parseDocument requires source.kind 'buffer' (with data) or 'text' (with text). Use the ai facade for box_path resolution."
      );
    }

    const modelId = request.model || this.defaultVisionModel;
    const model = this._getModel(
      modelId,
      this._generationConfig(request),
      this._safetySettings()
    );

    try {
      const result = await model.generateContent({
        contents: [{ role: 'user', parts }]
      });
      const mapped = _mapGeminiResponse(result, modelId, 'gemini');
      return {
        text: mapped.text,
        provider: 'gemini',
        model: modelId,
        mode,
        usage: mapped.usage,
        finishReason: mapped.finishReason
      };
    } catch (err) {
      this.logger.error(`[ai:gemini] parseDocument failed: ${err.message}`);
      throw new Error(`Gemini parseDocument failed: ${err.message}`);
    }
  }

  async moderate(request) {
    // Gemini has no separate OpenAI-style moderation endpoint; use a classifier prompt.
    const text = String(request.text || '');
    if (!text.trim()) {
      return { flagged: false, categories: {}, provider: 'gemini', scores: {} };
    }

    const model = this._getModel(
      this.defaultModel,
      { maxOutputTokens: 256, temperature: 0 },
      this._safetySettings()
    );

    const prompt = `You are a content safety classifier. Analyze the following text and reply with ONLY valid JSON:
{"flagged":boolean,"categories":{"hate":boolean,"harassment":boolean,"sexual":boolean,"violence":boolean,"self_harm":boolean,"dangerous":boolean}}
Text:
"""${text.slice(0, 8000)}"""`;

    try {
      const result = await model.generateContent(prompt);
      const mapped = _mapGeminiResponse(result, this.defaultModel, 'gemini');
      const parsed = _extractJson(mapped.text);
      return {
        flagged: !!(parsed && parsed.flagged),
        categories: (parsed && parsed.categories) || {},
        provider: 'gemini',
        scores: {},
        rawText: mapped.text
      };
    } catch (err) {
      // If Gemini safety blocks the request, treat as flagged when fail-closed semantics are desired by facade
      if (/SAFETY|blocked|safety/i.test(err.message)) {
        return {
          flagged: true,
          categories: { provider_safety_block: true },
          provider: 'gemini',
          scores: {},
          error: err.message
        };
      }
      this.logger.error(`[ai:gemini] moderate failed: ${err.message}`);
      throw new Error(`Gemini moderate failed: ${err.message}`);
    }
  }

  async shutdown() {}
}

function _prepareGeminiChat(request) {
  const messages = request.messages || [];
  let systemInstruction = request.system || null;
  const contents = [];
  let hasVision = false;

  for (const msg of messages) {
    if (!msg || !msg.role) continue;
    if (msg.role === 'system') {
      const t = _contentToPlainText(msg.content);
      systemInstruction = systemInstruction ? `${systemInstruction}\n${t}` : t;
      continue;
    }
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const parts = _contentToGeminiParts(msg.content);
    if (parts.some((p) => p.inlineData)) hasVision = true;
    contents.push({ role, parts });
  }

  if (!contents.length) {
    throw new Error('chat requires at least one non-system message.');
  }

  return { contents, systemInstruction, hasVision };
}

function _contentToPlainText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text')
      .map((p) => p.text || '')
      .join('\n');
  }
  return '';
}

function _contentToGeminiParts(content) {
  if (typeof content === 'string') {
    return [{ text: content }];
  }
  if (!Array.isArray(content)) {
    return [{ text: String(content || '') }];
  }
  const parts = [];
  for (const p of content) {
    if (!p) continue;
    if (p.type === 'text') {
      parts.push({ text: p.text || '' });
    } else if (p.type === 'image' || p.type === 'file') {
      const src = p.source || {};
      const mime = src.mime || p.mime || (p.type === 'image' ? 'image/jpeg' : 'application/octet-stream');
      let data = src.data || src.buffer || p.data;
      if (!data) {
        throw new Error(`${p.type} part requires source.data (Buffer or base64 string) after facade resolution.`);
      }
      if (Buffer.isBuffer(data)) data = data.toString('base64');
      parts.push({ inlineData: { data: String(data), mimeType: mime } });
    }
  }
  if (!parts.length) parts.push({ text: '' });
  return parts;
}

function _mapGeminiResponse(result, modelId, provider) {
  const response = result.response || result;
  let text = '';
  try {
    text = typeof response.text === 'function' ? response.text() : '';
  } catch (_) {
    text = '';
  }

  const usageMeta = response.usageMetadata || {};
  const cand = response.candidates && response.candidates[0];
  const finishReason = (cand && cand.finishReason) || 'stop';

  if (!text && cand && cand.finishReason === 'SAFETY') {
    throw new Error('Gemini blocked the response for safety reasons.');
  }

  return {
    text: text || '',
    message: { role: 'assistant', content: text || '' },
    model: modelId,
    provider,
    usage: {
      inputTokens: usageMeta.promptTokenCount || 0,
      outputTokens: usageMeta.candidatesTokenCount || usageMeta.totalTokenCount || 0
    },
    finishReason,
    raw: response
  };
}

function _extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
}

module.exports = GeminiAiAdapter;
