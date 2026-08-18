/**
 * Failed startup_scripts must not leave the app registered.
 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { als } = require('../../modules/gingee');
const { runStartupScripts } = require('../../modules/gapp_start');
const {
  _initializeOneApp: initializeOneApp,
} = require('../../modules/engine/app_registry');

describe('startup_scripts failure', () => {
  let tmp;
  let webPath;
  let appBoxPath;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-startup-'));
    webPath = path.join(tmp, 'web');
    appBoxPath = path.join(webPath, 'demo', 'box');
    fs.mkdirSync(path.join(appBoxPath, 'setup'), { recursive: true });
    fs.writeFileSync(
      path.join(appBoxPath, 'app.json'),
      JSON.stringify({
        name: 'Demo',
        version: '1.0.0',
        type: 'MPA',
        startup_scripts: ['setup/boom.js'],
      }),
    );
    fs.writeFileSync(
      path.join(appBoxPath, 'setup', 'boom.js'),
      `module.exports = async function () {
  await gingee(async () => {
    throw new Error('intentional startup failure');
  });
};
`,
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('runStartupScripts returns false when a script throws', async () => {
    const app = {
      name: 'demo',
      config: {
        startup_scripts: ['setup/boom.js'],
      },
      appBoxPath,
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() },
    };
    const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const ok = await als.run(
      { app, logger, globalConfig: { box: {}, privileged_apps: [] } },
      async () => runStartupScripts(app),
    );
    expect(ok).toBe(false);
  });

  test('initializeOneApp returns null when startup scripts fail', async () => {
    const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() };
    const app = await initializeOneApp('demo', webPath, { box: {} }, logger);
    expect(app).toBeNull();
  });
});
