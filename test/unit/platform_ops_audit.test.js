/**
 * Audit coverage for Glade ops: scheduler run-now, DLQ retry/discard, logs list/read.
 */
const path = require('path');
const { als } = require('../../modules/gingee');
const audit = require('../../modules/audit');
const platform = require('../../modules/platform');
const queueService = require('../../modules/engine/queue_service');
const scheduler = require('../../modules/scheduler');
const logViewer = require('../../modules/log_viewer');

describe('platform ops audit events', () => {
  let emitSpy;

  beforeEach(() => {
    emitSpy = jest.spyOn(audit, 'emit').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function runWithCtx(fn) {
    const webPath = path.resolve('/project/web');
    return als.run(
      {
        webPath,
        projectRoot: path.resolve('/project'),
        app: { name: 'glade' },
        appName: 'glade',
        logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
        allApps: {},
        globalConfig: { privileged_apps: ['glade'] }
      },
      fn
    );
  }

  test('retryQueueDlqJob emits queue.dlq.retry', async () => {
    jest.spyOn(queueService, 'retryDlqJob').mockResolvedValue({
      id: 'job-1',
      name: 'send-mail',
      appName: 'myapp',
      maxAttempts: 3
    });

    await runWithCtx(async () => {
      const r = await platform.retryQueueDlqJob('job-1');
      expect(r.id).toBe('job-1');
    });

    expect(emitSpy).toHaveBeenCalledWith(
      'queue.dlq.retry',
      expect.objectContaining({ jobId: 'job-1', jobName: 'send-mail' }),
      expect.objectContaining({ app: 'myapp' })
    );
  });

  test('discardQueueDlqJob emits queue.dlq.discard when successful', async () => {
    jest.spyOn(queueService, 'getDlqJob').mockResolvedValue({
      id: 'job-2',
      name: 'nightly',
      appName: 'billing'
    });
    jest.spyOn(queueService, 'discardDlqJob').mockResolvedValue(true);

    await runWithCtx(async () => {
      await platform.discardQueueDlqJob('job-2');
    });

    expect(emitSpy).toHaveBeenCalledWith(
      'queue.dlq.discard',
      expect.objectContaining({ jobId: 'job-2', jobName: 'nightly' }),
      expect.objectContaining({ app: 'billing' })
    );
  });

  test('discardQueueDlqJob does not emit when discard returns false', async () => {
    jest.spyOn(queueService, 'getDlqJob').mockResolvedValue(null);
    jest.spyOn(queueService, 'discardDlqJob').mockResolvedValue(false);

    await runWithCtx(async () => {
      await platform.discardQueueDlqJob('missing');
    });

    expect(emitSpy).not.toHaveBeenCalledWith(
      'queue.dlq.discard',
      expect.anything(),
      expect.anything()
    );
  });

  test('runSchedulerJob emits scheduler.run_now', async () => {
    jest.spyOn(scheduler, 'runNow').mockResolvedValue({
      appName: 'myapp',
      name: 'hourly',
      lastStatus: 'ok',
      lastError: null,
      lastStartedAt: 1,
      lastFinishedAt: 2,
      running: false
    });

    await runWithCtx(async () => {
      await platform.runSchedulerJob('myapp', 'hourly');
    });

    expect(emitSpy).toHaveBeenCalledWith(
      'scheduler.run_now',
      expect.objectContaining({
        jobName: 'hourly',
        force: true,
        lastStatus: 'ok'
      }),
      expect.objectContaining({ app: 'myapp' })
    );
  });

  test('listLogFiles emits logs.list', async () => {
    jest.spyOn(logViewer, 'listLogFiles').mockReturnValue({
      scope: 'server',
      appName: null,
      files: [{ name: 'gingee-2026-07-26.log' }, { name: 'gingee-2026-07-25.log' }]
    });

    await runWithCtx(async () => {
      platform.listLogFiles({ scope: 'server' });
    });

    expect(emitSpy).toHaveBeenCalledWith(
      'logs.list',
      expect.objectContaining({ scope: 'server', fileCount: 2 }),
      expect.objectContaining({ app: null })
    );
  });

  test('readLogFile emits logs.read without line content', async () => {
    jest.spyOn(logViewer, 'readLogFile').mockReturnValue({
      scope: 'app',
      appName: 'demo',
      file: 'app-2026-07-26.log',
      level: 'error',
      lineCountReturned: 12,
      lineCountRequested: 100,
      engineOnly: false,
      hideLogQueries: true,
      lines: [{ message: 'SECRET_SHOULD_NOT_BE_AUDITED' }]
    });

    await runWithCtx(async () => {
      platform.readLogFile({
        scope: 'app',
        appName: 'demo',
        file: 'app-2026-07-26.log',
        level: 'error'
      });
    });

    expect(emitSpy).toHaveBeenCalledWith(
      'logs.read',
      expect.objectContaining({
        scope: 'app',
        file: 'app-2026-07-26.log',
        level: 'error',
        lineCountReturned: 12,
        hideLogQueries: true
      }),
      expect.objectContaining({ app: 'demo' })
    );
    const details = emitSpy.mock.calls.find((c) => c[0] === 'logs.read')[1];
    expect(JSON.stringify(details)).not.toContain('SECRET_SHOULD_NOT_BE_AUDITED');
    expect(details.lines).toBeUndefined();
  });
});
