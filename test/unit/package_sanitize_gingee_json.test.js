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
});
