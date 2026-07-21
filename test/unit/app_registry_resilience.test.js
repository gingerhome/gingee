const fs = require('fs');
const os = require('os');
const path = require('path');
const { initializeApps } = require('../../modules/engine/app_registry');
const { loadJsonFile } = require('../../modules/internal_utils');

describe('app registry resilience', () => {
  let tmpRoot;
  let webPath;
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-appreg-'));
    webPath = path.join(tmpRoot, 'web');
    fs.mkdirSync(webPath, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  function writeApp(name, appJsonContent) {
    const box = path.join(webPath, name, 'box');
    fs.mkdirSync(box, { recursive: true });
    fs.writeFileSync(path.join(box, 'app.json'), appJsonContent, 'utf8');
  }

  test('loadJsonFile throws INVALID_JSON on bad JSON', () => {
    const f = path.join(tmpRoot, 'bad.json');
    fs.writeFileSync(f, '{ not json', 'utf8');
    expect(() => loadJsonFile(f)).toThrow(/Invalid JSON/);
    try {
      loadJsonFile(f);
    } catch (e) {
      expect(e.code).toBe('INVALID_JSON');
    }
  });

  test('initializeApps skips invalid app.json and still loads good apps', async () => {
    writeApp('good', JSON.stringify({ name: 'Good App', type: 'MPA' }));
    writeApp('broken', '{ "name": "broken", invalid }');

    const apps = await initializeApps(
      {
        logging: { level: 'error' },
        isolation: { mode: 'off' },
        scheduler: { enabled: false },
        privileged_apps: []
      },
      logger,
      webPath
    );

    expect(apps.good).toBeDefined();
    expect(apps.good.config.name).toBe('Good App');
    expect(apps.broken).toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/Skipping app 'broken'/)
    );
  });

  test('initializeApps continues when one app throws during later init', async () => {
    writeApp('ok', JSON.stringify({ name: 'ok' }));
    // Valid JSON but empty object is fine — use a second good app
    writeApp('also', JSON.stringify({ name: 'also' }));

    const apps = await initializeApps(
      {
        logging: { level: 'error' },
        isolation: { mode: 'off' },
        scheduler: { enabled: false },
        privileged_apps: []
      },
      logger,
      webPath
    );

    expect(Object.keys(apps).sort()).toEqual(['also', 'ok']);
  });
});
