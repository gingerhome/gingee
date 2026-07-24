/**
 * Integration-style unit test: fork a real app_worker, init, run scripts.
 * Covers buffered IPC, SSE stream IPC, isolation groups, and auto-restart.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const workerManager = require('../../modules/engine/isolation/worker_manager');

function writeApp(root, name, scripts) {
  const appWeb = path.join(root, 'web', name);
  const appBox = path.join(appWeb, 'box');
  fs.mkdirSync(appBox, { recursive: true });
  fs.writeFileSync(
    path.join(appBox, 'app.json'),
    JSON.stringify({ name, isolation: 'process' }),
    'utf8'
  );
  for (const [file, body] of Object.entries(scripts)) {
    fs.writeFileSync(path.join(appBox, file), body, 'utf8');
  }
  return {
    name,
    config: { name, isolation: 'process' },
    appWebPath: appWeb,
    appBoxPath: appBox,
    grantedPermissions: []
  };
}

function mockRes() {
  const chunks = [];
  const headers = {};
  const res = {
    headersSent: false,
    writableEnded: false,
    statusCode: 200,
    setHeader: jest.fn((k, v) => {
      headers[String(k).toLowerCase()] = v;
    }),
    getHeader: (k) => headers[String(k).toLowerCase()],
    flushHeaders: jest.fn(() => {
      res.headersSent = true;
    }),
    write: jest.fn((buf) => {
      res.headersSent = true;
      if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
    }),
    end: jest.fn((buf) => {
      if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
      res.writableEnded = true;
      res.headersSent = true;
    })
  };
  return { res, chunks, headers };
}

function baseConfig(extraIso = {}) {
  return {
    isolation: {
      mode: 'process',
      default: 'inprocess',
      apps: [],
      worker_ready_timeout_ms: 20000,
      request_timeout_ms: 15000,
      auto_restart: true,
      restart_max: 5,
      restart_delay_ms: 100,
      restart_backoff_max_ms: 500,
      restart_stable_ms: 60000,
      ...extraIso
    },
    privileged_apps: ['glade'],
    box: { allowed_modules: [], allow_code_generation: true },
    max_body_size: '1mb'
  };
}

describe('isolation worker IPC', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-iso-'));
  });

  afterEach(() => {
    workerManager.shutdownAll();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  test('worker runs script and returns JSON body', async () => {
    const app = writeApp(tmpRoot, 'demo', {
      'hello.js': `
module.exports = async function() {
  gingee(async ($g) => {
    $g.response.send({ hello: 'worker' }, 200, 'application/json');
  });
};
`
    });

    const cfg = baseConfig({ apps: ['demo'] });
    workerManager.init(
      cfg,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      path.join(tmpRoot, 'web')
    );
    workerManager.setAppsRegistry({ demo: app });
    await workerManager.startWorker(app, cfg);

    const { res, chunks } = mockRes();
    await workerManager.executeOnWorker({
      app,
      config: cfg,
      req: { method: 'GET', url: '/demo/hello', headers: { host: 'localhost' } },
      res,
      scriptPath: path.join(app.appBoxPath, 'hello.js'),
      routeParams: {},
      maxBodySize: '1mb',
      useCache: false,
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    });

    expect(res.end).toHaveBeenCalled();
    const body = Buffer.concat(chunks).toString('utf8');
    expect(JSON.parse(body)).toEqual({ hello: 'worker' });
    expect(res.statusCode).toBe(200);
  }, 30000);

  test('stream IPC flushes start/chunk/end to master res', async () => {
    const app = writeApp(tmpRoot, 'streamy', {
      'sse.js': `
module.exports = async function() {
  gingee(async ($g) => {
    $g.response.startStream(200, 'text/event-stream; charset=utf-8');
    $g.response.writeSSE({ token: 'hi' });
    $g.response.writeSSE({ token: 'there' });
    $g.response.endStream();
  });
};
`
    });

    const cfg = baseConfig({ apps: ['streamy'] });
    workerManager.init(
      cfg,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      path.join(tmpRoot, 'web')
    );
    workerManager.setAppsRegistry({ streamy: app });
    await workerManager.startWorker(app, cfg);

    const { res, chunks, headers } = mockRes();
    await workerManager.executeOnWorker({
      app,
      config: cfg,
      req: { method: 'GET', url: '/streamy/sse', headers: { host: 'localhost' } },
      res,
      scriptPath: path.join(app.appBoxPath, 'sse.js'),
      routeParams: {},
      maxBodySize: '1mb',
      useCache: false,
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    });

    expect(res.flushHeaders).toHaveBeenCalled();
    expect(res.write).toHaveBeenCalled();
    expect(res.end).toHaveBeenCalled();
    const body = Buffer.concat(chunks).toString('utf8');
    expect(body).toContain('data: {"token":"hi"}');
    expect(body).toContain('data: {"token":"there"}');
    expect(String(headers['content-type'] || '')).toMatch(/text\/event-stream/i);
  }, 30000);

  test('isolation group shares one worker for multiple apps', async () => {
    const appA = writeApp(tmpRoot, 'a', {
      'ping.js': `
module.exports = async function() {
  gingee(async ($g) => {
    $g.response.send({ app: 'a' }, 200, 'application/json');
  });
};
`
    });
    const appB = writeApp(tmpRoot, 'b', {
      'ping.js': `
module.exports = async function() {
  gingee(async ($g) => {
    $g.response.send({ app: 'b' }, 200, 'application/json');
  });
};
`
    });

    const cfg = baseConfig({
      groups: { shared: ['a', 'b'] }
    });
    workerManager.init(
      cfg,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      path.join(tmpRoot, 'web')
    );
    workerManager.setAppsRegistry({ a: appA, b: appB });

    const handleA = await workerManager.startWorker(appA, cfg);
    expect(handleA.workerKey).toBe('group:shared');
    expect(handleA.appNames.sort()).toEqual(['a', 'b']);

    // Second start for group member reuses / restarts same key — still one worker entry
    await workerManager.startWorker(appB, cfg);
    const stats = workerManager.getWorkerStats();
    expect(stats.filter((s) => s.workerKey === 'group:shared')).toHaveLength(1);

    const run = async (app) => {
      const { res, chunks } = mockRes();
      await workerManager.executeOnWorker({
        app,
        config: cfg,
        req: { method: 'GET', url: `/${app.name}/ping`, headers: { host: 'localhost' } },
        res,
        scriptPath: path.join(app.appBoxPath, 'ping.js'),
        routeParams: {},
        maxBodySize: '1mb',
        useCache: false,
        logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
      });
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    };

    expect(await run(appA)).toEqual({ app: 'a' });
    expect(await run(appB)).toEqual({ app: 'b' });
  }, 30000);

  test('auto-restart brings worker back after unexpected kill', async () => {
    const app = writeApp(tmpRoot, 'demo', {
      'hello.js': `
module.exports = async function() {
  gingee(async ($g) => {
    $g.response.send({ ok: true }, 200, 'application/json');
  });
};
`
    });

    const cfg = baseConfig({
      apps: ['demo'],
      restart_delay_ms: 50,
      restart_backoff_max_ms: 200,
      restart_max: 5
    });
    workerManager.init(
      cfg,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      path.join(tmpRoot, 'web')
    );
    workerManager.setAppsRegistry({ demo: app });
    const handle = await workerManager.startWorker(app, cfg);
    const firstPid = handle.child.pid;

    // Unexpected kill (not intentional stop)
    handle.child.kill('SIGKILL');

    // Wait for auto-restart
    const deadline = Date.now() + 8000;
    let recovered = null;
    while (Date.now() < deadline) {
      const stats = workerManager.getWorkerStats();
      const w = stats.find((s) => s.workerKey === 'app:demo');
      if (w && w.ready && w.pid && w.pid !== firstPid) {
        recovered = w;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(recovered).toBeTruthy();
    expect(recovered.restarts).toBeGreaterThanOrEqual(1);

    const { res, chunks } = mockRes();
    await workerManager.executeOnWorker({
      app,
      config: cfg,
      req: { method: 'GET', url: '/demo/hello', headers: { host: 'localhost' } },
      res,
      scriptPath: path.join(app.appBoxPath, 'hello.js'),
      routeParams: {},
      maxBodySize: '1mb',
      useCache: false,
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    });
    expect(JSON.parse(Buffer.concat(chunks).toString('utf8'))).toEqual({ ok: true });
  }, 30000);

  test('worker re-inits AI from app.json so require(ai) works', async () => {
    const app = writeApp(tmpRoot, 'aibot', {
      'chat.js': `
module.exports = async function() {
  // Must await gingee — worker sends http_result when this function returns
  await gingee(async ($g) => {
    try {
      const ai = require('ai');
      const result = await ai.chat({
        messages: [{ role: 'user', content: 'hi' }]
      });
      $g.response.send({ text: result.text || 'ok', provider: result.provider }, 200, 'application/json');
    } catch (e) {
      $g.response.send({ error: e.message }, 500, 'application/json');
    }
  });
};
`
    });
    // Mock AI provider — no external key; proves worker calls ai.initApp
    app.config.ai = { type: 'mock', default_model: 'mock-1' };
    app.grantedPermissions = ['ai'];

    const cfg = baseConfig({ apps: ['aibot'] });
    workerManager.init(
      cfg,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      path.join(tmpRoot, 'web')
    );
    workerManager.setAppsRegistry({ aibot: app });
    await workerManager.startWorker(app, cfg);

    const { res, chunks } = mockRes();
    await workerManager.executeOnWorker({
      app,
      config: cfg,
      req: { method: 'GET', url: '/aibot/chat', headers: { host: 'localhost' } },
      res,
      scriptPath: path.join(app.appBoxPath, 'chat.js'),
      routeParams: {},
      maxBodySize: '1mb',
      useCache: false,
      logger: { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    });

    const raw = Buffer.concat(chunks).toString('utf8');
    const body = JSON.parse(raw);
    expect(body.error).toBeUndefined();
    expect(res.statusCode).toBe(200);
    expect(body.text).toBeTruthy();
    expect(body.provider).toBe('mock');
  }, 30000);

  test('intentional stop does not auto-restart', async () => {
    const app = writeApp(tmpRoot, 'demo', {
      'hello.js': `
module.exports = async function() {
  gingee(async ($g) => {
    $g.response.send({ ok: true }, 200, 'application/json');
  });
};
`
    });

    const cfg = baseConfig({
      apps: ['demo'],
      restart_delay_ms: 50
    });
    workerManager.init(
      cfg,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      path.join(tmpRoot, 'web')
    );
    workerManager.setAppsRegistry({ demo: app });
    await workerManager.startWorker(app, cfg);
    workerManager.stopWorker('demo');

    await new Promise((r) => setTimeout(r, 300));
    const stats = workerManager.getWorkerStats();
    expect(stats.find((s) => s.workerKey === 'app:demo')).toBeUndefined();
  }, 15000);
});
