/**
 * HTTP correctness + relative burst latency for web/perftest instance cache.
 * Does not gate on absolute ms (machine-dependent); compares cache vs no_cache_regex.
 *
 * Requires gingee.json → box.local_modules to include "./local_modules" (mylib/store).
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startServer, stopServer, BASE_URL } = require('./test_server.helper');

function assertPerfTestHostConfig() {
  const cfgPath = path.resolve(__dirname, '..', '..', 'gingee.json');
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const roots = (cfg.box && cfg.box.local_modules) || [];
  const ok = Array.isArray(roots) && roots.some((r) => String(r).replace(/\\/g, '/') === './local_modules');
  if (!ok) {
    throw new Error(
      `perftest e2e requires gingee.json box.local_modules to include "./local_modules" ` +
        `(got ${JSON.stringify(roots)}).`,
    );
  }
  const storeJs = path.resolve(__dirname, '..', '..', 'local_modules', 'mylib', 'store.js');
  if (!fs.existsSync(storeJs)) {
    throw new Error(`Missing ${storeJs} — perftest fixture incomplete.`);
  }
}

const AGENT = new http.Agent({ keepAlive: true, maxSockets: 16 });

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[idx];
}

function stats(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1],
    min: sorted[0],
  };
}

/**
 * @param {string} urlPath e.g. /perftest/echo
 * @returns {Promise<{ status: number, body: object, ttfbMs: number, totalMs: number }>}
 */
function timedGet(urlPath) {
  const url = new URL(urlPath, BASE_URL);
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    const req = http.get(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        agent: AGENT,
      },
      (res) => {
        const ttfbNs = process.hrtime.bigint() - start;
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const totalNs = process.hrtime.bigint() - start;
          const raw = Buffer.concat(chunks).toString('utf8');
          let body;
          try {
            body = JSON.parse(raw);
          } catch (e) {
            return reject(
              new Error(
                `Non-JSON from ${urlPath} status=${res.statusCode}: ${raw.slice(0, 200)}`,
              ),
            );
          }
          resolve({
            status: res.statusCode,
            body,
            ttfbMs: Number(ttfbNs) / 1e6,
            totalMs: Number(totalNs) / 1e6,
          });
        });
      },
    );
    req.on('error', reject);
  });
}

async function sequential(urlPath, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(await timedGet(urlPath));
  }
  return out;
}

async function burst(urlPath, concurrency) {
  return Promise.all(
    Array.from({ length: concurrency }, () => timedGet(urlPath)),
  );
}

describe('perftest instance cache (e2e)', () => {
  beforeAll(async () => {
    assertPerfTestHostConfig();
    await startServer();
    // Fail fast if perftest is missing (stale server without local_modules).
    let probe;
    try {
      probe = await timedGet('/perftest/echo');
    } catch (e) {
      throw new Error(
        `perftest probe failed at ${BASE_URL}/perftest/echo: ${e.message}. ` +
          `Ensure web/perftest exists and the server loaded box.local_modules: ["./local_modules"] ` +
          `(restart if a stale Gingee was already listening).`,
      );
    }
    if (probe.status !== 200 || !probe.body || !probe.body.ok) {
      throw new Error(
        `perftest app not available at ${BASE_URL}/perftest/echo (status=${probe.status}). ` +
          `Restart Gingee after enabling box.local_modules.`,
      );
    }
  }, 60000);

  afterAll(async () => {
    AGENT.destroy();
    await stopServer();
  });

  test('cached echo: loads stay 1 and loadedAt stable across 20 requests', async () => {
    const rows = await sequential('/perftest/echo', 20);
    expect(rows.every((r) => r.status === 200)).toBe(true);
    expect(rows.every((r) => r.body.loads === 1)).toBe(true);
    expect(rows.every((r) => r.body.utilLoads === 1)).toBe(true);
    const storeAt = rows[0].body.storeLoadedAt;
    const utilAt = rows[0].body.utilLoadedAt;
    expect(rows.every((r) => r.body.storeLoadedAt === storeAt)).toBe(true);
    expect(rows.every((r) => r.body.utilLoadedAt === utilAt)).toBe(true);
  });

  test('counter: loadN stays 1; callN increases every request', async () => {
    const rows = await sequential('/perftest/counter', 20);
    expect(rows.every((r) => r.status === 200)).toBe(true);
    expect(rows.every((r) => r.body.loadN === 1)).toBe(true);
    // Allow a warm process (reused server) where callN does not start at 1.
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].body.callN).toBe(rows[i - 1].body.callN + 1);
    }
    expect(rows[rows.length - 1].body.callN - rows[0].body.callN).toBe(19);
  });

  test('nocache echo: module body re-runs (loadedAt changes)', async () => {
    const rows = await sequential('/perftest/nocache/echo', 8);
    expect(rows.every((r) => r.status === 200)).toBe(true);
    const storeAts = new Set(rows.map((r) => r.body.storeLoadedAt));
    const utilAts = new Set(rows.map((r) => r.body.utilLoadedAt));
    // Fresh module instances each request → distinct load timestamps.
    expect(storeAts.size).toBeGreaterThan(1);
    expect(utilAts.size).toBeGreaterThan(1);
  });

  test('circular require endpoint works', async () => {
    const r = await timedGet('/perftest/circ/entry');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      ok: true,
      a: 'a',
      b: 'b',
      aSeesB: 'b',
      bSeesA: 'a',
    });
  });

  test('burst-of-6: cached path clearly faster than nocache path', async () => {
    // Measure cached path first. Nocache (useCache=false) deletes instance
    // entries for the same files — never interleave the two phases.

    await sequential('/perftest/echo', 8);
    const seqCached = await sequential('/perftest/echo', 40);
    const seqCachedStats = stats(seqCached.map((r) => r.ttfbMs));

    const burstsCached = [];
    for (let round = 0; round < 8; round++) {
      const c = await burst('/perftest/echo', 6);
      burstsCached.push(...c.map((r) => r.ttfbMs));
    }
    const cachedBurst = stats(burstsCached);

    await sequential('/perftest/nocache/echo', 4);
    const burstsNocache = [];
    for (let round = 0; round < 8; round++) {
      const n = await burst('/perftest/nocache/echo', 6);
      burstsNocache.push(...n.map((r) => r.ttfbMs));
    }
    const nocacheBurst = stats(burstsNocache);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          sequentialCachedTtfb: seqCachedStats,
          burstCachedTtfb: cachedBurst,
          burstNocacheTtfb: nocacheBurst,
          ratioNocacheOverCachedP50:
            cachedBurst.p50 > 0 ? nocacheBurst.p50 / cachedBurst.p50 : null,
        },
        null,
        2,
      ),
    );

    // Relative gates (order-of-magnitude intent from performance-enhancements.md)
    expect(nocacheBurst.p50).toBeGreaterThan(cachedBurst.p50 * 2);
    // Cached burst should stay in the same ballpark as sequential cached.
    expect(cachedBurst.p50).toBeLessThanOrEqual(seqCachedStats.p50 * 3 + 5);
    // Cached burst max should not be an order of magnitude above its p50.
    expect(cachedBurst.max).toBeLessThan(cachedBurst.p50 * 10 + 20);
  }, 120000);
});
