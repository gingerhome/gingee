/**
 * Harness for fs caller-relative behavior (invoked by Jest via spawnSync).
 */
const path = require('path');
const os = require('os');
const nodeFs = require('fs');
const { als } = require('../../modules/gingee');
const { runInGBox } = require('../../modules/gbox');

const tmp = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'gingee-fs-caller-'));
const boxPath = path.join(tmp, 'box');
nodeFs.mkdirSync(path.join(boxPath, 'api'), { recursive: true });
nodeFs.mkdirSync(path.join(boxPath, 'lib'), { recursive: true });
nodeFs.mkdirSync(path.join(boxPath, 'library'), { recursive: true });

nodeFs.writeFileSync(
  path.join(boxPath, 'lib', 'helper.js'),
  `const fs = require('fs');
module.exports = {
  write() {
    fs.writeFileSync(fs.BOX, 'sidecar.txt', 'lib', 'utf8');
    return 'sidecar.txt';
  },
  read() {
    return fs.readFileSync(fs.BOX, 'sidecar.txt', 'utf8');
  }
};
`,
);

nodeFs.writeFileSync(
  path.join(boxPath, 'api', 'probe.js'),
  `const fs = require('fs');
const helper = require('../lib/helper');
module.exports = {
  run() {
    fs.writeFileSync(fs.BOX, 'entry.txt', 'entry', 'utf8');
    helper.write();
    return {
      entryExists: fs.existsSync(fs.BOX, 'entry.txt'),
      libViaRoot: fs.readFileSync(fs.BOX, '/lib/sidecar.txt', 'utf8'),
      libRelative: helper.read()
    };
  }
};
`,
);

nodeFs.writeFileSync(
  path.join(boxPath, 'library', 'wrap.js'),
  `const fs = require('fs');
module.exports = {
  writeRel(name, data) {
    fs.writeFileSync(fs.BOX, name, data, 'utf8');
  }
};
`,
);

const logger = { info() {}, warn() {}, error() {} };
const app = {
  name: 'demo',
  config: {},
  grantedPermissions: ['fs'],
  appBoxPath: boxPath,
  appWebPath: path.join(tmp, 'web'),
};
const gBoxConfig = {
  appName: 'demo',
  app,
  appBoxPath: boxPath,
  globalModulesPath: path.resolve(__dirname, '../../modules'),
  localModulesPaths: [],
  allowedBuiltinModules: [],
  privilegedApps: [],
  useCache: false,
  logger,
};
const store = {
  appName: 'demo',
  app,
  scriptPath: path.join(boxPath, 'api', 'probe.js'),
  scriptFolder: path.join(boxPath, 'api'),
  logger,
  req: { headers: {}, connection: {} },
  res: { writeHead() {}, end() {}, setHeader() {} },
};

try {
  als.run(store, () => {
    const mod = runInGBox(path.join(boxPath, 'api', 'probe.js'), gBoxConfig);
    const result = mod.run();
    if (
      result.entryExists &&
      result.libViaRoot === 'lib' &&
      result.libRelative === 'lib' &&
      nodeFs.existsSync(path.join(boxPath, 'api', 'entry.txt')) &&
      nodeFs.existsSync(path.join(boxPath, 'lib', 'sidecar.txt'))
    ) {
      console.log('NESTED_OK');
    } else {
      console.error('NESTED_FAIL', result);
      process.exitCode = 1;
    }

    store.fsScriptFolder = path.join(boxPath, 'api');
    const wrap = runInGBox(path.join(boxPath, 'library', 'wrap.js'), {
      ...gBoxConfig,
      applyModuleOverrides: false,
    });
    wrap.writeRel('kept-in-api.txt', 'x');
    if (
      nodeFs.existsSync(path.join(boxPath, 'api', 'kept-in-api.txt')) &&
      !nodeFs.existsSync(path.join(boxPath, 'library', 'kept-in-api.txt'))
    ) {
      console.log('OVERRIDE_OK');
    } else {
      console.error('OVERRIDE_FAIL');
      process.exitCode = 1;
    }
  });
} finally {
  nodeFs.rmSync(tmp, { recursive: true, force: true });
}
