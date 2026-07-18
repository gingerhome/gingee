const { als } = require('../../modules/gingee');

const mockChat = jest.fn();
const mockChatStream = jest.fn();
const mockComplete = jest.fn();
const mockParse = jest.fn();
const mockModerate = jest.fn();
const mockShutdown = jest.fn();

jest.mock('../../modules/ai_providers/mock', () => {
  return jest.fn().mockImplementation(function MockAdapter(config) {
    this.config = config;
    this.chat = mockChat;
    this.chatStream = mockChatStream;
    this.complete = mockComplete;
    this.parseDocument = mockParse;
    this.moderate = mockModerate;
    this.shutdown = mockShutdown;
  });
});

jest.mock('../../modules/ai_providers/gemini', () => {
  return jest.fn().mockImplementation(function GeminiAdapter(config) {
    this.config = config;
    this.chat = mockChat;
    this.chatStream = mockChatStream;
    this.complete = mockComplete;
    this.parseDocument = mockParse;
    this.moderate = mockModerate;
    this.shutdown = mockShutdown;
  });
});

const MockAdapter = require('../../modules/ai_providers/mock');
const GeminiAdapter = require('../../modules/ai_providers/gemini');
const ai = require('../../modules/ai');

describe('ai.js facade', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    ai._resetForTests();
    mockChat.mockResolvedValue({
      text: 'hello',
      provider: 'mock',
      model: 'mock-model',
      usage: { inputTokens: 1, outputTokens: 1 }
    });
    mockComplete.mockResolvedValue({
      text: 'done',
      provider: 'mock',
      model: 'mock-model',
      usage: { inputTokens: 1, outputTokens: 1 }
    });
    mockParse.mockResolvedValue({ text: 'parsed', provider: 'mock', mode: 'ocr' });
    mockModerate.mockResolvedValue({ flagged: false, provider: 'mock', categories: {} });
    mockChatStream.mockImplementation(async function* () {
      yield { textDelta: 'Hi', done: false, provider: 'mock' };
      yield { textDelta: '', text: 'Hi', done: true, provider: 'mock' };
    });
  });

  test('normalizeType aliases', () => {
    expect(ai._normalizeType('google')).toBe('gemini');
    expect(ai._normalizeType('grok')).toBe('xai');
    expect(ai._normalizeType('dev')).toBe('mock');
  });

  test('merge config deep-merges safety', () => {
    const m = ai._mergeConfig(
      { type: 'mock', safety: { enabled: false } },
      { safety: { fail_closed: true } }
    );
    expect(m.safety).toEqual({ enabled: false, fail_closed: true });
  });

  test('chat uses app mock adapter', async () => {
    const app = { name: 'demo', config: { ai: { type: 'mock' } } };
    ai.initApp(app, logger);
    expect(MockAdapter).toHaveBeenCalled();

    await als.run({ appName: 'demo', app, logger }, async () => {
      const r = await ai.chat({
        messages: [{ role: 'user', content: 'Hello' }]
      });
      expect(r.text).toBe('hello');
      expect(mockChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello' }]
        })
      );
    });
  });

  test('chatStream yields deltas', async () => {
    const app = { name: 'demo', config: { ai: { type: 'mock' } } };
    ai.initApp(app, logger);

    await als.run({ appName: 'demo', app, logger }, async () => {
      const chunks = [];
      for await (const c of ai.chatStream({
        messages: [{ role: 'user', content: 'Hi' }]
      })) {
        chunks.push(c);
      }
      expect(chunks.length).toBe(2);
      expect(chunks[0].textDelta).toBe('Hi');
      expect(chunks[1].done).toBe(true);
    });
  });

  test('per-call config override creates ephemeral gemini adapter', async () => {
    const app = { name: 'demo', config: { ai: { type: 'mock' } } };
    ai.initApp(app, logger);
    jest.clearAllMocks();
    mockChat.mockResolvedValue({ text: 'from-gemini', provider: 'gemini', model: 'g' });

    await als.run({ appName: 'demo', app, logger }, async () => {
      const r = await ai.chat(
        { messages: [{ role: 'user', content: 'x' }] },
        { config: { type: 'gemini', api_key: 'AIza-test' } }
      );
      expect(GeminiAdapter).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'gemini', api_key: 'AIza-test' }),
        app,
        logger
      );
      expect(r.text).toBe('from-gemini');
      expect(mockShutdown).toHaveBeenCalled();

      // default still mock
      mockChat.mockResolvedValue({ text: 'mock-again', provider: 'mock', model: 'm' });
      const r2 = await ai.chat({ messages: [{ role: 'user', content: 'y' }] });
      expect(r2.provider).toBe('mock');
    });
  });

  test('chat throws without config', async () => {
    const app = { name: 'bare', config: {} };
    ai.initApp(app, logger);
    await als.run({ appName: 'bare', app, logger }, async () => {
      await expect(
        ai.chat({ messages: [{ role: 'user', content: 'x' }] })
      ).rejects.toThrow(/No AI configuration/);
    });
  });

  test('moderate and parseDocument delegate', async () => {
    const app = { name: 'demo', config: { ai: { type: 'mock' } } };
    ai.initApp(app, logger);
    await als.run({ appName: 'demo', app, logger }, async () => {
      await ai.moderate({ text: 'hello' });
      expect(mockModerate).toHaveBeenCalled();

      await ai.parseDocument({
        source: { kind: 'text', text: 'doc body' },
        mode: 'summarize'
      });
      expect(mockParse).toHaveBeenCalledWith(
        expect.objectContaining({
          source: expect.objectContaining({ kind: 'text' }),
          mode: 'summarize'
        })
      );
    });
  });

  test('safety fail-closed blocks when moderate_input flags content', async () => {
    const app = {
      name: 'demo',
      config: {
        ai: {
          type: 'mock',
          safety: { enabled: true, fail_closed: true, moderate_input: true }
        }
      }
    };
    ai.initApp(app, logger);
    mockModerate.mockResolvedValue({ flagged: true, categories: { hate: true }, provider: 'mock' });

    await als.run({ appName: 'demo', app, logger }, async () => {
      await expect(
        ai.chat({ messages: [{ role: 'user', content: 'bad' }] })
      ).rejects.toThrow(/safety/i);
      expect(mockChat).not.toHaveBeenCalled();
    });
  });

  test('xai provider stub throws until P1', () => {
    const Xai = jest.requireActual('../../modules/ai_providers/xai');
    expect(() => new Xai({ type: 'xai', api_key: 'x' }, { name: 'a' }, logger)).toThrow(
      /P1|not implemented/i
    );
  });
});

describe('ai_providers/mock.js (real)', () => {
  test('streams and chats', async () => {
    const Mock = jest.requireActual('../../modules/ai_providers/mock');
    const adapter = new Mock({}, { name: 't' }, console);
    const r = await adapter.chat({
      messages: [{ role: 'user', content: 'Ping' }]
    });
    expect(r.text).toContain('Ping');
    expect(r.provider).toBe('mock');

    const parts = [];
    for await (const c of adapter.chatStream({
      messages: [{ role: 'user', content: 'Stream me' }]
    })) {
      parts.push(c);
    }
    expect(parts.some((p) => p.done)).toBe(true);
    expect(parts[parts.length - 1].text).toContain('Stream me');
  });
});
