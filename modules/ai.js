const fs = require('fs');
const { getContext } = require('./gingee.js');
const { resolveSecurePath, SCOPES } = require('./internal_utils.js');
const secrets = require('./secrets.js');

/**
 * @module ai
 * @description
 * Generative AI for Gingee apps (chat, multimodal, document parsing, content safety)
 * via provider adapters — similar to `db` / `email`.
 *
 * <b>Configuration (single config):</b>
 * - Server defaults: `gingee.json` → `ai`
 * - App override: `app.json` → `ai`
 * - Per-call override: pass `{ config: { … } }` as the second argument to any method
 *
 * <b>Providers:</b>
 * - `mock` — local deterministic responses (dev/tests)
 * - `gemini` — Google Gemini (v1)
 * - `xai` — Grok via xAI (P1 — stub until implemented)
 *
 * <b>Streaming:</b> `ai.chatStream(request, options)` yields chunk objects; final chunk has `done: true`.
 *
 * <b>IMPORTANT:</b> Requires the `ai` permission. See docs/permissions-guide.
 */

/** @type {Map<string, { adapter: object, config: object }>} */
const aiInstances = new Map();

/** @type {object|null} */
let serverAiConfig = null;

const PROVIDERS = {
  mock: require('./ai_providers/mock.js'),
  gemini: require('./ai_providers/gemini.js'),
  xai: require('./ai_providers/xai.js')
};

function mergeConfig(...parts) {
  const out = {};
  for (const part of parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    for (const [k, v] of Object.entries(part)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && k === 'safety') {
        out.safety = { ...(out.safety || {}), ...v };
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

function normalizeType(type) {
  if (!type) return null;
  const t = String(type).toLowerCase();
  if (t === 'google' || t === 'google_gemini') return 'gemini';
  if (t === 'grok') return 'xai'; // alias → canonical xai
  if (t === 'test' || t === 'fake' || t === 'dev') return 'mock';
  return t;
}

function createAdapter(config, app, logger) {
  const type = normalizeType(config && config.type);
  if (!type) {
    throw new Error("AI config is missing 'type' (e.g. 'gemini', 'mock').");
  }
  const AdapterClass = PROVIDERS[type];
  if (!AdapterClass) {
    throw new Error(
      `Unknown AI provider '${type}'. Supported: ${Object.keys(PROVIDERS).join(', ')} (xai is P1 stub).`
    );
  }
  return new AdapterClass(config, app, logger);
}

function initServer(aiConfig, logger) {
  serverAiConfig =
    aiConfig && typeof aiConfig === 'object' && !Array.isArray(aiConfig) ? { ...aiConfig } : null;
  if (serverAiConfig && serverAiConfig.type) {
    logger.info(`[ai] Server default AI provider: '${normalizeType(serverAiConfig.type)}'`);
  } else {
    logger.info('[ai] No server-level AI config; apps may set app.json ai or pass per-call config.');
  }
}

function initApp(app, logger) {
  if (!app || !app.name) throw new Error('ai.initApp requires an app with a name.');
  const appConfig =
    app.config && app.config.ai && typeof app.config.ai === 'object' && !Array.isArray(app.config.ai)
      ? app.config.ai
      : null;
  const merged = mergeConfig(serverAiConfig, appConfig);
  if (!merged.type) {
    aiInstances.delete(app.name);
    logger.info(`[ai] App '${app.name}' has no AI type configured.`);
    return;
  }
  try {
    const adapter = createAdapter(merged, app, logger);
    aiInstances.set(app.name, { adapter, config: merged });
    logger.info(`[ai] Initialized AI for app '${app.name}' with provider '${normalizeType(merged.type)}'`);
  } catch (e) {
    aiInstances.delete(app.name);
    logger.error(`[ai] Failed to init AI for app '${app.name}': ${e.message}`);
    throw e;
  }
}

async function shutdownApp(appName, logger) {
  const entry = aiInstances.get(appName);
  if (!entry) return;
  try {
    if (entry.adapter && typeof entry.adapter.shutdown === 'function') {
      await entry.adapter.shutdown();
    }
  } catch (err) {
    if (logger) logger.error(`[ai] Error shutting down AI for '${appName}': ${err.message}`);
  }
  aiInstances.delete(appName);
}

async function reinitApp(appName, app, logger) {
  await shutdownApp(appName, logger);
  initApp(app, logger);
}

function _context() {
  const { appName, app, logger } = getContext();
  if (!appName) throw new Error('AI module cannot determine app context.');
  return { appName, app, logger, entry: aiInstances.get(appName) };
}

/**
 * Resolve effective adapter + config for a call (optional per-call config override).
 * @private
 */
function _resolveCall(options = {}) {
  const { appName, app, logger, entry } = _context();
  const base =
    (entry && entry.config) ||
    mergeConfig(serverAiConfig, app && app.config && app.config.ai);

  if (options.config && typeof options.config === 'object') {
    // Resolve env:/file: refs in per-call overrides (engine-side; sandbox still has no process).
    const effective = mergeConfig(base, secrets.resolveDeep(options.config));
    if (!normalizeType(effective.type)) {
      throw new Error("AI call config override is missing 'type'.");
    }
    const adapter = createAdapter(effective, app || { name: appName }, logger || console);
    return { adapter, config: effective, ephemeral: true, logger };
  }

  if (!entry || !entry.adapter) {
    throw new Error(
      `No AI configuration for app '${appName}'. Set ai in app.json or gingee.json, or pass { config: { type, api_key, … } }.`
    );
  }
  return { adapter: entry.adapter, config: entry.config, ephemeral: false, logger };
}

async function _maybeShutdown(resolved) {
  if (resolved.ephemeral && resolved.adapter && typeof resolved.adapter.shutdown === 'function') {
    try {
      await resolved.adapter.shutdown();
    } catch (_) {
      /* ignore */
    }
  }
}

/**
 * Resolve image/file sources that use box_path / web_path into buffers.
 * @private
 */
async function resolveMessageSources(messages) {
  if (!Array.isArray(messages)) return messages;
  const out = [];
  for (const msg of messages) {
    if (!msg || typeof msg.content === 'string' || !Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }
    const parts = [];
    for (const part of msg.content) {
      if (!part || (part.type !== 'image' && part.type !== 'file')) {
        parts.push(part);
        continue;
      }
      parts.push({ ...part, source: await _resolveSource(part.source || part) });
    }
    out.push({ ...msg, content: parts });
  }
  return out;
}

async function _resolveSource(source) {
  if (!source) throw new Error('Media part is missing source.');
  if (source.kind === 'buffer' || source.data || source.buffer) {
    return {
      kind: 'buffer',
      data: source.data || source.buffer,
      mime: source.mime
    };
  }
  if (source.kind === 'base64' && source.data) {
    return { kind: 'buffer', data: source.data, mime: source.mime };
  }
  if (source.kind === 'box_path' || source.kind === 'web_path') {
    const scope = source.kind === 'web_path' ? SCOPES.WEB : SCOPES.BOX;
    const abs = resolveSecurePath(scope, source.path || source.file || source.filePath);
    const data = fs.readFileSync(abs);
    return { kind: 'buffer', data, mime: source.mime };
  }
  if (source.kind === 'text') {
    return source;
  }
  throw new Error(
    `Unsupported media source kind '${source.kind}'. Use buffer, box_path, web_path, or text.`
  );
}

async function _resolveDocumentSource(source) {
  if (!source) throw new Error('parseDocument requires a source.');
  if (source.kind === 'text') return source;
  if (source.kind === 'buffer' || source.data || source.buffer) {
    return {
      kind: 'buffer',
      data: source.data || source.buffer,
      mime: source.mime,
      name: source.name
    };
  }
  if (source.kind === 'box_path' || source.kind === 'web_path') {
    const scope = source.kind === 'web_path' ? SCOPES.WEB : SCOPES.BOX;
    const pathArg = source.path || source.file || source.filePath;
    const abs = resolveSecurePath(scope, pathArg);
    const data = fs.readFileSync(abs);
    return {
      kind: 'buffer',
      data,
      mime: source.mime,
      name: pathArg,
      path: pathArg
    };
  }
  throw new Error(`Unsupported document source kind '${source.kind}'.`);
}

function _applySafetyGate(config, moderation) {
  const safety = (config && config.safety) || {};
  if (!safety.enabled) return;
  if (moderation && moderation.flagged && safety.fail_closed !== false) {
    const err = new Error('Content blocked by AI safety policy.');
    err.code = 'AI_SAFETY_BLOCKED';
    err.moderation = moderation;
    throw err;
  }
}

/**
 * @function chat
 * @memberof module:ai
 * @description Chat / text generation (supports multimodal content parts). Non-streaming.
 * @param {object} request
 * @param {Array<object>} request.messages - Chat messages: `{ role, content }` where content is a string or array of parts
 * @param {string} [request.system]
 * @param {string} [request.model]
 * @param {number} [request.temperature]
 * @param {number} [request.maxTokens]
 * @param {object} [options]
 * @param {object} [options.config] - Per-call AI config override
 * @returns {Promise<object>} Result with `text`, `model`, `provider`, `usage`, etc.
 */
async function chat(request, options = {}) {
  const resolved = _resolveCall(options);
  try {
    const req = { ...request, messages: await resolveMessageSources(request.messages || []) };
    if (resolved.config.safety && resolved.config.safety.enabled && resolved.config.safety.moderate_input) {
      const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
      if (lastUser) {
        const text =
          typeof lastUser.content === 'string'
            ? lastUser.content
            : (lastUser.content || [])
                .filter((p) => p.type === 'text')
                .map((p) => p.text)
                .join('\n');
        if (text) {
          const mod = await resolved.adapter.moderate({ text });
          _applySafetyGate(resolved.config, mod);
        }
      }
    }
    return await resolved.adapter.chat(req);
  } finally {
    await _maybeShutdown(resolved);
  }
}

/**
 * @function chatStream
 * @memberof module:ai
 * @description Streaming chat. Async generator yielding `{ textDelta, done, … }`.
 * Final chunk has `done: true` and full `text`.
 * @param {object} request - Same as {@link module:ai.chat}
 * @param {object} [options]
 * @param {object} [options.config]
 * @returns {AsyncGenerator<object>}
 * @example
 * for await (const chunk of ai.chatStream({ messages: [{ role: 'user', content: 'Hi' }] })) {
 *   if (!chunk.done) process.stdout.write(chunk.textDelta);
 * }
 */
async function* chatStream(request, options = {}) {
  const resolved = _resolveCall(options);
  try {
    if (typeof resolved.adapter.chatStream !== 'function') {
      throw new Error(
        `Provider '${normalizeType(resolved.config.type)}' does not support streaming.`
      );
    }
    const req = { ...request, messages: await resolveMessageSources(request.messages || []) };
    for await (const chunk of resolved.adapter.chatStream(req)) {
      yield chunk;
    }
  } finally {
    await _maybeShutdown(resolved);
  }
}

/**
 * @function complete
 * @memberof module:ai
 * @description Single-prompt completion (wrapper over chat).
 */
async function complete(request, options = {}) {
  const resolved = _resolveCall(options);
  try {
    if (typeof resolved.adapter.complete === 'function') {
      return await resolved.adapter.complete(request);
    }
    return await resolved.adapter.chat({
      messages: [{ role: 'user', content: request.prompt || '' }],
      model: request.model,
      temperature: request.temperature,
      maxTokens: request.maxTokens
    });
  } finally {
    await _maybeShutdown(resolved);
  }
}

/**
 * @function parseDocument
 * @memberof module:ai
 * @description OCR / extract / summarize a document (buffer, text, or sandboxed path).
 */
async function parseDocument(request, options = {}) {
  const resolved = _resolveCall(options);
  try {
    const source = await _resolveDocumentSource(request.source);
    return await resolved.adapter.parseDocument({ ...request, source });
  } finally {
    await _maybeShutdown(resolved);
  }
}

/**
 * @function moderate
 * @memberof module:ai
 * @description Content safety check for text (and provider-dependent media later).
 */
async function moderate(request, options = {}) {
  const resolved = _resolveCall(options);
  try {
    return await resolved.adapter.moderate(request || {});
  } finally {
    await _maybeShutdown(resolved);
  }
}

module.exports = {
  chat,
  chatStream,
  complete,
  parseDocument,
  moderate,

  initServer,
  initApp,
  shutdownApp,
  reinitApp,

  _mergeConfig: mergeConfig,
  _normalizeType: normalizeType,
  _resetForTests: () => {
    aiInstances.clear();
    serverAiConfig = null;
  }
};
