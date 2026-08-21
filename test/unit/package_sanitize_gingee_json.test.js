/**
 * Build-time sanitization of gingee.json for gingee-cli project templates.
 */
const {
  sanitizeGingeeJsonForCliTemplate,
} = require('../../build/package.js');

describe('sanitizeGingeeJsonForCliTemplate', () => {
  test('resets local port, scrubs secrets, and defaults local_modules to []', () => {
    const sanitized = sanitizeGingeeJsonForCliTemplate({
      server: {
        http: { enabled: true, port: 8080 },
        https: { enabled: true, port: 8443, key_file: '/secret/key.pem' },
      },
      box: {
        allowed_modules: ['path'],
        local_modules: ['./local_modules'],
        localModulesPaths: ['/abs/should/not/ship'],
        allow_dynamic_code: false,
      },
      content_encoding: { enabled: true, size_threshold: 2048 },
      logging: { level: 'info', rotation: { period_days: 3 } },
      cache: { provider: 'redis', redis: { url: 'redis://x', password: 'p' } },
      metrics: { enabled: true, bearer_token: 'tok' },
      secrets: {
        load_dotenv: true,
        file_roots: ['./settings/secrets', '/etc/passwd', '/run/secrets'],
      },
      isolation: { mode: 'off', apps: ['x'], groups: { g: ['a'] } },
      privileged_apps: ['glade', 'glide'],
      default_app: 'glade',
      web_root: './web',
    });

    expect(sanitized.server.http.port).toBe(7070);
    expect(sanitized.server.https.enabled).toBe(false);
    expect(sanitized.logging.level).toBe('error');
    expect(sanitized.box.local_modules).toEqual([]);
    expect(sanitized.box.localModulesPaths).toBeUndefined();
    expect(sanitized.content_encoding.enabled).toBe(true);
    expect(sanitized.content_encoding.size_threshold).toBe(2048);
    expect(sanitized.content_encoding.min_bytes).toBeUndefined();
    expect(sanitized.cache.redis.url).toBeNull();
    expect(sanitized.cache.redis.password).toBeNull();
    expect(sanitized.metrics.bearer_token).toBeNull();
    expect(sanitized.secrets.load_dotenv).toBe(false);
    expect(sanitized.secrets.file_roots).toEqual([
      './settings/secrets',
      '/run/secrets',
    ]);
    expect(sanitized.isolation.apps).toEqual([]);
    expect(sanitized.isolation.groups).toEqual({});
    expect(sanitized.privileged_apps).toContain('glade');
  });

  test('content_encoding defaults size_threshold and migrates legacy min_bytes', () => {
    const fromLegacy = sanitizeGingeeJsonForCliTemplate({
      content_encoding: { enabled: true, min_bytes: 512 },
      box: {},
      server: { http: {}, https: {} },
      logging: {},
    });
    expect(fromLegacy.content_encoding.size_threshold).toBe(512);
    expect(fromLegacy.content_encoding.min_bytes).toBeUndefined();

    const missing = sanitizeGingeeJsonForCliTemplate({
      box: {},
      server: { http: {}, https: {} },
      logging: {},
    });
    expect(missing.content_encoding.enabled).toBe(true);
    expect(missing.content_encoding.size_threshold).toBe(1024);

    const bad = sanitizeGingeeJsonForCliTemplate({
      content_encoding: { enabled: false, size_threshold: -1 },
      box: {},
      server: { http: {}, https: {} },
      logging: {},
    });
    expect(bad.content_encoding.enabled).toBe(false);
    expect(bad.content_encoding.size_threshold).toBe(1024);
  });
});
