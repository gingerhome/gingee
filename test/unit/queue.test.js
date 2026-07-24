/**
 * Queue service + public module (memory driver).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const queueService = require('../../modules/engine/queue_service');
const { als } = require('../../modules/gingee');
const queue = require('../../modules/queue');

describe('queue service (memory)', () => {
  let tmp;
  let app;
  let results;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-q-'));
    const box = path.join(tmp, 'box');
    fs.mkdirSync(path.join(box, 'jobs'), { recursive: true });
    // Capture via app.logger (sandbox has isolated global; use $g.log)
    results = [];
    let failOnce = false;

    fs.writeFileSync(
      path.join(box, 'jobs', 'echo.js'),
      `
module.exports = async function () {
  await gingee(async ($g) => {
    $g.log.info(
      'QRESULT:' +
        JSON.stringify({
          payload: $g.queue.payload,
          attempt: $g.queue.attempt,
          name: $g.queue.name
        })
    );
    $g.response.send({ ok: true });
  });
};
`
    );

    fs.writeFileSync(
      path.join(box, 'jobs', 'fail_once.js'),
      `
module.exports = async function () {
  await gingee(async ($g) => {
    $g.log.info('QFAIL_CHECK');
    // First run fails — second succeeds (tracked via host results length of QRESULT only)
    throw new Error('intentional fail');
  });
};
`
    );

    // fail_once rewritten below after we know we need host-side attempt tracking via logger
    fs.writeFileSync(
      path.join(box, 'jobs', 'fail_once.js'),
      `
module.exports = async function () {
  await gingee(async ($g) => {
    if ($g.queue.attempt < 2) {
      throw new Error('intentional fail');
    }
    $g.log.info('QRESULT:' + JSON.stringify({ recovered: true, attempt: $g.queue.attempt }));
  });
};
`
    );

    app = {
      name: 'qapp',
      config: { name: 'qapp' },
      appBoxPath: box,
      appWebPath: path.join(tmp, 'web'),
      grantedPermissions: ['queue'],
      logger: {
        info: (msg) => {
          const s = String(msg);
          if (s.startsWith('QRESULT:')) {
            results.push(JSON.parse(s.slice('QRESULT:'.length)));
          }
        },
        warn: jest.fn(),
        error: jest.fn()
      },
      in_maintenance: false
    };

    await queueService.shutdown();
    await queueService.initServer(
      {
        enabled: true,
        driver: 'memory',
        concurrency: 2,
        default_attempts: 3,
        default_backoff_ms: 50
      },
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { box: { allowed_modules: [], allow_code_generation: true }, privileged_apps: [] }
    );
    queueService.setAppsRegistry({ qapp: app });
  });

  afterEach(async () => {
    await queueService.shutdown();
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  async function waitForResults(n, ms = 3000) {
    const start = Date.now();
    while (Date.now() - start < ms) {
      if (results.length >= n) return results;
      await new Promise((r) => setTimeout(r, 30));
    }
    throw new Error('timeout waiting for job results: ' + JSON.stringify(results));
  }

  test('add + process job handler with $g.queue', async () => {
    const ref = await queueService.addJob(app, 'echo', { hello: 'world' });
    expect(ref.id).toBeTruthy();
    const lines = await waitForResults(1);
    expect(lines[0].payload).toEqual({ hello: 'world' });
    expect(lines[0].name).toBe('echo');
    expect(lines[0].attempt).toBe(1);
  }, 10000);

  test('retries on failure then succeeds', async () => {
    await queueService.addJob(app, 'fail_once', {}, { attempts: 3, backoffMs: 30 });
    const lines = await waitForResults(1, 5000);
    expect(lines[0].recovered).toBe(true);
    expect(lines[0].attempt).toBeGreaterThanOrEqual(2);
  }, 10000);

  test('public module add requires context + permission', async () => {
    await als.run({ appName: 'qapp', app }, async () => {
      const ref = await queue.add('echo', { via: 'public' });
      expect(ref.appName).toBe('qapp');
    });
    const lines = await waitForResults(1);
    expect(lines[0].payload.via).toBe('public');
  }, 10000);

  test('isEnabled and getStats', () => {
    expect(queueService.isEnabled()).toBe(true);
    expect(queueService.getStats().driver).toBe('memory');
  });
});
