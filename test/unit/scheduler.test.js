const path = require('path');
const fs = require('fs');
const os = require('os');

jest.mock('axios');
const axios = require('axios');

const scheduler = require('../../modules/scheduler');
const egress = require('../../modules/egress');
const { als, gingee } = require('../../modules/gingee');

describe('scheduler.js', () => {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };

  let tmpRoot;
  let appBoxPath;

  beforeEach(() => {
    jest.clearAllMocks();
    scheduler._resetForTests();
    egress._resetForTests();
    // Avoid real DNS for URL schedule registration in unit tests.
    egress.initServer({ mode: 'protected', dns_check: false }, logger);
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-sched-'));
    appBoxPath = path.join(tmpRoot, 'box');
    fs.mkdirSync(path.join(appBoxPath, 'jobs'), { recursive: true });
  });

  afterEach(() => {
    scheduler._resetForTests();
    egress._resetForTests();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  function makeApp(overrides = {}) {
    return {
      name: 'sched_app',
      appBoxPath,
      in_maintenance: false,
      grantedPermissions: ['scheduler'],
      logger,
      config: {
        name: 'Sched App',
        version: '1.0.0',
        description: 'test',
        env: {},
        schedules: [],
        ...overrides.config
      },
      ...overrides
    };
  }

  describe('_normalizeSchedule', () => {
    test('accepts a valid script schedule', () => {
      const r = scheduler._normalizeSchedule(
        {
          name: 'nightly',
          cron: '0 2 * * *',
          target: { type: 'script', path: 'jobs/cleanup.js' }
        },
        'app'
      );
      expect(r.ok).toBe(true);
      expect(r.job.target.type).toBe('script');
      expect(r.job.target.path).toBe('jobs/cleanup.js');
      expect(r.job.timeout_ms).toBe(300000);
      expect(r.job.overlap).toBe('skip');
    });

    test('accepts a valid URL schedule', () => {
      const r = scheduler._normalizeSchedule(
        {
          name: 'ping',
          cron: '*/5 * * * *',
          target: {
            type: 'url',
            url: 'https://example.com/hook',
            method: 'POST',
            headers: { 'X-A': '1' },
            body: { ok: true }
          }
        },
        'app'
      );
      expect(r.ok).toBe(true);
      expect(r.job.target.url).toBe('https://example.com/hook');
      expect(r.job.target.method).toBe('POST');
      expect(r.job.timeout_ms).toBe(60000);
    });

    test('rejects path traversal and absolute paths', () => {
      expect(
        scheduler._normalizeSchedule(
          {
            name: 'bad',
            cron: '* * * * *',
            target: { type: 'script', path: '../other/x.js' }
          },
          'app'
        ).ok
      ).toBe(false);

      expect(
        scheduler._normalizeSchedule(
          {
            name: 'bad2',
            cron: '* * * * *',
            target: { type: 'script', path: path.resolve('/tmp/x.js') }
          },
          'app'
        ).ok
      ).toBe(false);
    });

    test('rejects invalid cron and non-http URL', () => {
      expect(
        scheduler._normalizeSchedule(
          {
            name: 'x',
            cron: 'not a cron',
            target: { type: 'script', path: 'a.js' }
          },
          'app'
        ).ok
      ).toBe(false);

      expect(
        scheduler._normalizeSchedule(
          {
            name: 'y',
            cron: '* * * * *',
            target: { type: 'url', url: 'ftp://example.com' }
          },
          'app'
        ).ok
      ).toBe(false);
    });
  });

  describe('registerApp / server gate', () => {
    test('does not register when scheduler is disabled (default)', async () => {
      scheduler.initServer({ enabled: false }, logger, {});
      const app = makeApp({
        config: {
          schedules: [
            {
              name: 'n',
              cron: '0 0 * * *',
              target: { type: 'script', path: 'jobs/a.js' }
            }
          ]
        }
      });
      await scheduler.registerApp(app);
      expect(scheduler.listJobs()).toHaveLength(0);
    });

    test('does not register without scheduler permission', async () => {
      scheduler.initServer({ enabled: true, timezone: 'UTC' }, logger, {});
      const app = makeApp({
        grantedPermissions: [],
        config: {
          schedules: [
            {
              name: 'n',
              cron: '0 0 * * *',
              target: { type: 'script', path: 'jobs/a.js' }
            }
          ]
        }
      });
      await scheduler.registerApp(app);
      expect(scheduler.listJobs()).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
    });

    test('skips URL jobs without httpclient permission', async () => {
      scheduler.initServer({ enabled: true }, logger, {});
      const app = makeApp({
        grantedPermissions: ['scheduler'],
        config: {
          schedules: [
            {
              name: 'u',
              cron: '0 0 * * *',
              target: { type: 'url', url: 'https://example.com' }
            }
          ]
        }
      });
      await scheduler.registerApp(app);
      expect(scheduler.listJobs()).toHaveLength(0);
      expect(logger.error).toHaveBeenCalled();
    });

    test('registers valid jobs when enabled and permitted', async () => {
      scheduler.initServer({ enabled: true, timezone: 'UTC' }, logger, {});
      fs.writeFileSync(path.join(appBoxPath, 'jobs', 'a.js'), 'module.exports = async function(){}');
      const app = makeApp({
        grantedPermissions: ['scheduler', 'httpclient'],
        config: {
          schedules: [
            {
              name: 'script_job',
              cron: '0 3 * * *',
              target: { type: 'script', path: 'jobs/a.js' }
            },
            {
              name: 'url_job',
              cron: '0 4 * * *',
              target: { type: 'url', url: 'https://example.com/t' }
            },
            {
              name: 'disabled_job',
              cron: '0 5 * * *',
              enabled: false,
              target: { type: 'script', path: 'jobs/a.js' }
            }
          ]
        }
      });
      await scheduler.registerApp(app);
      const jobs = scheduler.listJobs();
      expect(jobs.map((j) => j.name).sort()).toEqual(['script_job', 'url_job']);
      scheduler.unregisterApp(app.name);
      expect(scheduler.listJobs()).toHaveLength(0);
    });
  });

  describe('runNow execution', () => {
    test('runs a script job with synthetic $g.schedule', async () => {
      scheduler.initServer({ enabled: true }, logger, {
        box: { allowed_modules: [] },
        privileged_apps: []
      });

      const marker = path.join(appBoxPath, 'jobs', 'ran.txt');
      const script = `
        module.exports = async function () {
          await gingee(async ($g) => {
            const fs = require('fs');
            if (!$g.schedule || $g.schedule.name !== 'marker_job') {
              throw new Error('missing schedule meta');
            }
            if ($g.request.method !== 'SCHEDULE') {
              throw new Error('bad method');
            }
            fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({
              name: $g.schedule.name,
              body: $g.request.body
            }));
            $g.response.send({ ok: true });
          });
        };
      `;
      // Use sandbox-safe APIs only: write via Node fs is NOT available in sandbox.
      // Instead assert via response send path and logger / side-effect file using absolute path outside require('fs') sandbox...
      // Sandbox has no free Node fs. Write using gingee path: only modules. Use a global flag via process which sandbox may block.
      // Best approach: script uses no fs; test spies on logger and uses payload echo via scheduleResult.
      // Actually runInGBox blocks node fs. Use a closure file written by putting side effect in temp using only allowed...
      // Simplest: don't use fs in script; throw if schedule missing; success if completes.

      const scriptPath = path.join(appBoxPath, 'jobs', 'marker.js');
      fs.writeFileSync(
        scriptPath,
        `module.exports = async function () {
  await gingee(async ($g) => {
    if (!$g.schedule || $g.schedule.name !== 'marker_job') {
      throw new Error('missing schedule meta: ' + JSON.stringify($g.schedule));
    }
    if ($g.request.method !== 'SCHEDULE') {
      throw new Error('bad method ' + $g.request.method);
    }
    if (!$g.request.body || $g.request.body.mode !== 'full') {
      throw new Error('bad payload');
    }
    $g.response.send({ ok: true, job: $g.schedule.name });
  });
};
`
      );

      const app = makeApp({
        grantedPermissions: ['scheduler'],
        config: {
          schedules: [
            {
              name: 'marker_job',
              cron: '0 0 1 1 *',
              payload: { mode: 'full' },
              target: { type: 'script', path: 'jobs/marker.js' }
            }
          ]
        }
      });

      await scheduler.registerApp(app);
      const result = await scheduler.runNow(app.name, 'marker_job');
      expect(result.lastStatus).toBe('ok');
      expect(result.appName).toBe(app.name);
      expect(result.name).toBe('marker_job');
      const jobs = scheduler.listJobs();
      expect(jobs[0].lastStatus).toBe('ok');
      expect(jobs[0].targetSummary).toMatch(/script:/);
      const status = scheduler.getAdminStatus();
      expect(status.enabled).toBe(true);
      expect(status.jobCount).toBe(1);
      scheduler.unregisterApp(app.name);
    });

    test('runs a URL job via axios when httpclient granted', async () => {
      axios.mockResolvedValue({ status: 200, data: 'ok' });
      scheduler.initServer({ enabled: true }, logger, {});
      const app = makeApp({
        grantedPermissions: ['scheduler', 'httpclient'],
        config: {
          schedules: [
            {
              name: 'hook',
              cron: '0 0 1 1 *',
              target: {
                type: 'url',
                url: 'https://hooks.example.com/t',
                method: 'POST',
                body: { hello: 'world' }
              }
            }
          ]
        }
      });
      await scheduler.registerApp(app);
      await scheduler.runNow(app.name, 'hook');
      expect(axios).toHaveBeenCalled();
      const call = axios.mock.calls[0][0];
      expect(call.url).toBe('https://hooks.example.com/t');
      expect(call.method).toBe('POST');
      expect(scheduler.listJobs()[0].lastStatus).toBe('ok');
      scheduler.unregisterApp(app.name);
    });

    test('skips when app is in maintenance', async () => {
      scheduler.initServer({ enabled: true }, logger, {});
      fs.writeFileSync(
        path.join(appBoxPath, 'jobs', 'x.js'),
        'module.exports = async function(){ throw new Error("should not run"); };'
      );
      const app = makeApp({
        in_maintenance: true,
        grantedPermissions: ['scheduler'],
        config: {
          schedules: [
            {
              name: 'm',
              cron: '0 0 1 1 *',
              target: { type: 'script', path: 'jobs/x.js' }
            }
          ]
        }
      });
      await scheduler.registerApp(app);
      await scheduler.runNow(app.name, 'm');
      expect(scheduler.listJobs()[0].lastStatus).toBe('skipped_maintenance');
      scheduler.unregisterApp(app.name);
    });

    // --- M5: schedule timeout aborts work ---
    test('URL job timeout aborts axios via signal and marks timeout', async () => {
      // Simulate a hung outbound call that only ends when AbortSignal fires.
      axios.mockImplementation((config) => {
        return new Promise((resolve, reject) => {
          const signal = config.signal;
          if (signal) {
            if (signal.aborted) {
              const err = new Error('canceled');
              err.code = 'ERR_CANCELED';
              reject(err);
              return;
            }
            signal.addEventListener(
              'abort',
              () => {
                const err = new Error('canceled');
                err.code = 'ERR_CANCELED';
                reject(err);
              },
              { once: true }
            );
          }
          // Never resolve without abort — would hang the suite.
        });
      });

      scheduler.initServer({ enabled: true }, logger, {});
      const app = makeApp({
        grantedPermissions: ['scheduler', 'httpclient'],
        config: {
          schedules: [
            {
              name: 'slow_url',
              cron: '0 0 1 1 *',
              timeout_ms: 1000,
              target: {
                type: 'url',
                url: 'https://hooks.example.com/slow',
                method: 'GET'
              }
            }
          ]
        }
      });
      await scheduler.registerApp(app);
      const started = Date.now();
      await scheduler.runNow(app.name, 'slow_url');
      const elapsed = Date.now() - started;
      expect(scheduler.listJobs()[0].lastStatus).toBe('timeout');
      expect(scheduler.listJobs()[0].lastError).toMatch(/timed out/i);
      // Should not wait the full default 60s — abort + race should finish near timeout_ms.
      expect(elapsed).toBeLessThan(8000);
      expect(axios).toHaveBeenCalled();
      const call = axios.mock.calls[0][0];
      expect(call.signal).toBeDefined();
      expect(typeof call.signal.aborted).toBe('boolean');
      scheduler.unregisterApp(app.name);
    });

    test('script job exposes abort signal on $g.request and times out', async () => {
      scheduler.initServer({ enabled: true }, logger, {
        box: { allowed_modules: [] },
        privileged_apps: []
      });

      const scriptPath = path.join(appBoxPath, 'jobs', 'slow_script.js');
      fs.writeFileSync(
        scriptPath,
        `module.exports = async function () {
  await gingee(async ($g) => {
    if (!$g.request || !$g.request.signal) {
      throw new Error('missing abort signal on schedule request');
    }
    // Wait until aborted or long timeout
    await new Promise((resolve, reject) => {
      const s = $g.request.signal;
      if (s.aborted) return resolve();
      s.addEventListener('abort', () => resolve(), { once: true });
      setTimeout(() => reject(new Error('signal never aborted')), 30000);
    });
  });
};
`
      );

      const app = makeApp({
        grantedPermissions: ['scheduler'],
        config: {
          schedules: [
            {
              name: 'slow_script',
              cron: '0 0 1 1 *',
              timeout_ms: 1000,
              target: { type: 'script', path: 'jobs/slow_script.js' }
            }
          ]
        }
      });

      await scheduler.registerApp(app);
      await scheduler.runNow(app.name, 'slow_script');
      expect(scheduler.listJobs()[0].lastStatus).toBe('timeout');
      expect(scheduler.listJobs()[0].lastError).toMatch(/timed out/i);
      scheduler.unregisterApp(app.name);
    }, 15000);
  });

  describe('multi-node coordination', () => {
    test('initServer stores coordination.driver + sibling redis', () => {
      scheduler.initServer(
        {
          enabled: true,
          coordination: {
            driver: 'redis',
            strategy: 'tick',
            node_id: 'test-node'
          },
          redis: { key_prefix: 'gingee:scheduler:test:', url: 'redis://127.0.0.1:6379' }
        },
        logger,
        {}
      );
      const cfg = scheduler._getServerConfig();
      expect(cfg.coordination.driver).toBe('redis');
      expect(cfg.coordination.strategy).toBe('tick');
      expect(cfg.coordination.node_id).toBe('test-node');
      expect(cfg.redis.key_prefix).toBe('gingee:scheduler:test:');
      expect(cfg.redis.url).toBe('redis://127.0.0.1:6379');
    });

    test('_runJob skips when coordinator denies (not force)', async () => {
      scheduler.initServer({ enabled: true }, logger, {
        box: { allowed_modules: [] },
        privileged_apps: []
      });
      fs.writeFileSync(
        path.join(appBoxPath, 'jobs', 'c.js'),
        'module.exports = async function(){ throw new Error("should not run"); };'
      );
      const app = makeApp({
        grantedPermissions: ['scheduler'],
        config: {
          schedules: [
            {
              name: 'coord_job',
              cron: '0 0 1 1 *',
              target: { type: 'script', path: 'jobs/c.js' }
            }
          ]
        }
      });
      await scheduler.registerApp(app);

      scheduler._setCoordinatorForTests({
        enabled: () => true,
        tryAllowRun: async () => ({ allow: false, reason: 'tick_held' })
      });

      const runtime = {
        app,
        def: {
          name: 'coord_job',
          cron: '0 0 1 1 *',
          timezone: 'UTC',
          timeout_ms: 5000,
          overlap: 'skip',
          payload: {},
          target: { type: 'script', path: 'jobs/c.js' }
        },
        running: false,
        lastStatus: null,
        lastError: null,
        cronJob: null
      };

      await scheduler._runJob(app, runtime);
      expect(runtime.lastStatus).toBe('skipped_coordination');

      // runNow forces past coordination
      await scheduler.runNow(app.name, 'coord_job');
      // script throws — status error, not skipped_coordination
      expect(scheduler.listJobs()[0].lastStatus).toBe('error');

      scheduler._setCoordinatorForTests(null);
      scheduler.unregisterApp(app.name);
    });

    test('_runJob fail-closed on redis_error', async () => {
      scheduler.initServer({ enabled: true }, logger, {});
      const app = makeApp({ name: 'a2' });
      const runtime = {
        app,
        def: {
          name: 'j',
          cron: '* * * * *',
          timezone: 'UTC',
          timeout_ms: 1000,
          target: { type: 'script', path: 'jobs/x.js' }
        },
        running: false,
        lastStatus: null,
        lastError: null
      };
      scheduler._setCoordinatorForTests({
        enabled: () => true,
        tryAllowRun: async () => ({
          allow: false,
          reason: 'redis_error',
          detail: 'ECONNREFUSED'
        })
      });
      await scheduler._runJob(app, runtime);
      expect(runtime.lastStatus).toBe('skipped_coord_error');
      expect(runtime.lastError).toMatch(/ECONNREFUSED/);
      scheduler._setCoordinatorForTests(null);
    });
  });
});
