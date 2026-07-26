/**
 * Unit tests for cache redis connection resolution (no live Redis required).
 */
const {
  _resolveRedisConnection: resolve
} = require('../../modules/cache_drivers/redis_adapter');

describe('cache redis_adapter connection resolution', () => {
  test('uses nested cache.redis url (queue/scheduler pattern)', () => {
    const c = resolve({
      provider: 'redis',
      prefix: 'gingee:',
      redis: { url: 'redis://:secret@redis.example:6379/2' }
    });
    expect(c.kind).toBe('url');
    expect(c.url).toBe('redis://:secret@redis.example:6379/2');
    expect(c.options.enableReadyCheck).toBe(true);
  });

  test('uses nested host/port/password/db when no url', () => {
    const c = resolve({
      provider: 'redis',
      redis: {
        host: '10.0.0.5',
        port: 6380,
        password: 'p',
        db: 3
      }
    });
    expect(c.kind).toBe('options');
    expect(c.options.host).toBe('10.0.0.5');
    expect(c.options.port).toBe(6380);
    expect(c.options.password).toBe('p');
    expect(c.options.db).toBe(3);
  });

  test('defaults host/port/db when redis block is empty', () => {
    const c = resolve({ provider: 'redis', redis: {} });
    expect(c.kind).toBe('options');
    expect(c.options.host).toBe('127.0.0.1');
    expect(c.options.port).toBe(6379);
    expect(c.options.db).toBe(0);
  });

  test('legacy flat host/port on config (no nested redis) still works', () => {
    const c = resolve({ host: 'legacy.local', port: 6390 });
    expect(c.kind).toBe('options');
    expect(c.options.host).toBe('legacy.local');
    expect(c.options.port).toBe(6390);
  });

  test('nested redis preferred over stray top-level host', () => {
    const c = resolve({
      host: 'ignored',
      redis: { host: 'nested', port: 6379 }
    });
    expect(c.options.host).toBe('nested');
  });

  test('url wins over host when both present under redis', () => {
    const c = resolve({
      redis: {
        url: 'redis://primary:6379',
        host: 'should-not-use',
        port: 1
      }
    });
    expect(c.kind).toBe('url');
    expect(c.url).toBe('redis://primary:6379');
  });
});
