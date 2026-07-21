const {
  buildDefaultConfig,
  mergeUserConfig,
  applyHttpPortEnvOverride
} = require('../../modules/engine/config');

describe('engine/config', () => {
  const prevPort = process.env.GINGEE_HTTP_PORT;

  afterEach(() => {
    if (prevPort === undefined) delete process.env.GINGEE_HTTP_PORT;
    else process.env.GINGEE_HTTP_PORT = prevPort;
  });

  test('buildDefaultConfig includes core control sections', () => {
    const d = buildDefaultConfig();
    expect(d.server.http.port).toBe(7070);
    expect(d.scheduler.enabled).toBe(false);
    expect(d.metrics.allow_from).toEqual(expect.arrayContaining(['127.0.0.1']));
    expect(d.privileged_apps).toContain('glade');
  });

  test('mergeUserConfig deep-merges server and egress lists from user', () => {
    const merged = mergeUserConfig(buildDefaultConfig(), {
      server: { http: { port: 8080 } },
      egress: { mode: 'allowlist', allow_hosts: ['api.example.com'] },
      logging: { level: 'info', rotation: { max_size_mb: 10 } }
    });
    expect(merged.server.http.port).toBe(8080);
    // Shallow server merge (legacy behavior): user http object replaces defaults' http keys.
    expect(merged.egress.mode).toBe('allowlist');
    expect(merged.egress.allow_hosts).toEqual(['api.example.com']);
    expect(merged.logging.level).toBe('info');
    expect(merged.logging.rotation.max_size_mb).toBe(10);
    expect(merged.logging.rotation.period_days).toBe(7);
  });

  test('applyHttpPortEnvOverride sets http port when GINGEE_HTTP_PORT is set', () => {
    process.env.GINGEE_HTTP_PORT = '9099';
    const config = buildDefaultConfig();
    applyHttpPortEnvOverride(config);
    expect(config.server.http.port).toBe(9099);
    expect(config.server.http.enabled).toBe(true);
  });
});
