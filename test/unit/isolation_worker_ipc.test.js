/**
 * Integration-style unit test: fork a real app_worker, init, run a tiny script.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const workerManager = require('../../modules/engine/isolation/worker_manager');

describe('isolation worker IPC', () => {
  let tmpRoot;
  let appBox;
  let appWeb;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-iso-'));
    appWeb = path.join(tmpRoot, 'web', 'demo');
    appBox = path.join(appWeb, 'box');
    fs.mkdirSync(appBox, { recursive: true });
    fs.writeFileSync(
      path.join(appBox, 'app.json'),
      JSON.stringify({ name: 'demo', isolation: 'process' }),
      'utf8'
    );
    fs.writeFileSync(
      path.join(appBox, 'hello.js'),
      `
module.exports = async function() {
  gingee(async ($g) => {
    $g.response.send({ hello: 'worker' }, 200, 'application/json');
  });
};
`,
      'utf8'
    );

    workerManager.init(
      {
        isolation: {
          mode: 'process',
          default: 'inprocess',
          apps: ['demo'],
          worker_ready_timeout_ms: 20000,
          request_timeout_ms: 15000
        },
        privileged_apps: ['glade'],
        box: { allowed_modules: [], allow_code_generation: true },
        max_body_size: '1mb'
      },
      {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
      },
      path.join(tmpRoot, 'web')
    );
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
    const app = {
      name: 'demo',
      config: { name: 'demo', isolation: 'process' },
      appWebPath: appWeb,
      appBoxPath: appBox,
      grantedPermissions: []
    };

    await workerManager.startWorker(app);

    const chunks = [];
    const res = {
      headersSent: false,
      statusCode: 200,
      setHeader: jest.fn(),
      end: jest.fn((buf) => {
        if (buf) chunks.push(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
      })
    };

    const req = {
      method: 'GET',
      url: '/demo/hello',
      headers: { host: 'localhost' }
    };

    await workerManager.executeOnWorker({
      app,
      config: {
        isolation: { mode: 'process', apps: ['demo'] },
        privileged_apps: ['glade'],
        box: { allow_code_generation: true },
        max_body_size: '1mb'
      },
      req,
      res,
      scriptPath: path.join(appBox, 'hello.js'),
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
});
