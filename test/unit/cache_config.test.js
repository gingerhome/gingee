const path = require('path');
const os = require('os');
const fs = require('fs');
const {
  compileNoCacheRegex,
  matchesNoCache,
  attachCompiledCacheRegex,
} = require('../../modules/engine/request/cache_config');
const { isPathInside } = require('../../modules/internal_utils');

describe('cache_config compiled no_cache_regex', () => {
  test('compileNoCacheRegex skips invalid patterns', () => {
    const compiled = compileNoCacheRegex([
      '\\/nocache\\/',
      '(unterminated',
      '',
      null,
      '\\/api\\/',
    ]);
    expect(compiled).toHaveLength(2);
    expect(matchesNoCache(compiled, '/app/nocache/echo')).toBe(true);
    expect(matchesNoCache(compiled, '/app/api/x')).toBe(true);
    expect(matchesNoCache(compiled, '/app/ok')).toBe(false);
  });

  test('attachCompiledCacheRegex refreshes from app.config.cache', () => {
    const app = {
      config: {
        cache: {
          client: { enabled: true, no_cache_regex: ['\\/private\\/'] },
          server: { enabled: true, no_cache_regex: ['\\/nocache\\/'] },
        },
      },
    };
    attachCompiledCacheRegex(app);
    expect(app.compiledCacheRegex.serverNoCache).toHaveLength(1);
    expect(
      matchesNoCache(app.compiledCacheRegex.serverNoCache, '/x/nocache/y'),
    ).toBe(true);
    expect(
      matchesNoCache(app.compiledCacheRegex.clientNoCache, '/x/private/y'),
    ).toBe(true);

    // Simulate reload with new patterns
    app.config.cache.server.no_cache_regex = ['\\/live\\/'];
    attachCompiledCacheRegex(app);
    expect(
      matchesNoCache(app.compiledCacheRegex.serverNoCache, '/x/nocache/y'),
    ).toBe(false);
    expect(
      matchesNoCache(app.compiledCacheRegex.serverNoCache, '/x/live/y'),
    ).toBe(true);
  });

  test('attachAppPathReals caches web/box realpaths for jail reuse', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-reals-'));
    const web = path.join(tmp, 'webapp');
    const box = path.join(web, 'box');
    fs.mkdirSync(box, { recursive: true });
    const app = {
      config: { cache: {} },
      appWebPath: web,
      appBoxPath: box,
    };
    attachCompiledCacheRegex(app);
    expect(app.appWebPathReal).toBeTruthy();
    expect(app.appBoxPathReal).toBeTruthy();
    expect(
      isPathInside(box, web, { boundaryReal: app.appWebPathReal }),
    ).toBe(true);
    expect(
      isPathInside(path.join(web, 'index.html'), web, {
        boundaryReal: app.appWebPathReal,
      }),
    ).toBe(true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
