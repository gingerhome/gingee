/**
 * Fail-closed Redis init for queue + cache (no silent memory fallback).
 */
const queueService = require('../../modules/engine/queue_service');
const cacheService = require('../../modules/cache_service');
const redisAdapter = require('../../modules/cache_drivers/redis_adapter');
const redisDriver = require('../../modules/queue_drivers/redis');

describe('cache_service fail_closed', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('resolveFailClosed defaults true for redis, respects explicit false', () => {
    expect(cacheService.resolveFailClosed({ provider: 'redis' }, 'redis')).toBe(true);
    expect(
      cacheService.resolveFailClosed({ provider: 'redis', fail_closed: false }, 'redis')
    ).toBe(false);
    expect(
      cacheService.resolveFailClosed({ provider: 'redis', fail_closed: true }, 'redis')
    ).toBe(true);
    expect(cacheService.resolveFailClosed({ provider: 'memory' }, 'memory')).toBe(false);
  });

  test('redis init failure with fail_closed=true throws and does not use memory', async () => {
    jest.spyOn(redisAdapter, 'init').mockRejectedValue(new Error('connection refused'));

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    await expect(
      cacheService.init({ provider: 'redis', fail_closed: true, redis: {} }, logger)
    ).rejects.toMatchObject({ code: 'CACHE_REDIS_FAIL_CLOSED' });

    expect(cacheService.getProvider()).toBeNull();
    await expect(cacheService.get('k')).rejects.toThrow(/not initialized/);
  });

  test('redis init failure with fail_closed=false falls back to memory', async () => {
    jest.spyOn(redisAdapter, 'init').mockRejectedValue(new Error('connection refused'));

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    await cacheService.init(
      { provider: 'redis', fail_closed: false, redis: {}, ttl: 60 },
      logger
    );
    expect(cacheService.getProvider()).toBe('memory');
    await cacheService.set('k', { ok: 1 }, 60);
    expect(await cacheService.get('k')).toEqual({ ok: 1 });
  });

  test('memory provider still works', async () => {
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    await cacheService.init({ provider: 'memory' }, logger);
    expect(cacheService.getProvider()).toBe('memory');
    await cacheService.set('a', 'b', 10);
    expect(await cacheService.get('a')).toBe('b');
  });
});

describe('queue_service fail_closed', () => {
  afterEach(async () => {
    jest.restoreAllMocks();
    await queueService.shutdown({ force: true, drainMs: 0 });
  });

  test('redis driver + fail_closed true throws when start fails', async () => {
    jest.spyOn(redisDriver, 'createRedisDriver').mockReturnValue({
      name: 'redis',
      async start() {
        throw new Error('ECONNREFUSED mock');
      },
      async shutdown() {}
    });

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    await expect(
      queueService.initServer(
        {
          enabled: true,
          driver: 'redis',
          fail_closed: true,
          redis: { host: '127.0.0.1', port: 1 }
        },
        logger,
        {}
      )
    ).rejects.toMatchObject({ code: 'QUEUE_REDIS_FAIL_CLOSED' });

    expect(queueService.isEnabled()).toBe(false);
    expect(queueService.getStats().driver).toBeNull();
  });

  test('redis driver + fail_closed false falls back to memory', async () => {
    jest.spyOn(redisDriver, 'createRedisDriver').mockReturnValue({
      name: 'redis',
      async start() {
        throw new Error('ECONNREFUSED mock');
      },
      async shutdown() {}
    });

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    await queueService.initServer(
      {
        enabled: true,
        driver: 'redis',
        fail_closed: false,
        concurrency: 1,
        redis: { host: '127.0.0.1', port: 1 }
      },
      logger,
      {}
    );
    expect(queueService.isEnabled()).toBe(true);
    expect(queueService.getStats().driver).toBe('memory');
    expect(logger.error).toHaveBeenCalled();
  });

  test('fail_closed defaults to true in DEFAULTS', () => {
    expect(queueService.DEFAULTS.fail_closed).toBe(true);
  });
});
