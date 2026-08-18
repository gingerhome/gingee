/**
 * fs readJSON / writeJSON (sync and async) under ALS context.
 */
const path = require('path');
const os = require('os');
const nodeFs = require('fs');
const { als } = require('../../modules/gingee');
const fsModule = require('../../modules/fs');

describe('fs readJSON / writeJSON', () => {
  let tmpRoot;
  let boxPath;
  let store;

  beforeEach(() => {
    tmpRoot = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'gingee-fs-json-'));
    boxPath = path.join(tmpRoot, 'box');
    nodeFs.mkdirSync(boxPath, { recursive: true });
    store = {
      app: {
        name: 'demo',
        appBoxPath: boxPath,
        appWebPath: path.join(tmpRoot, 'web'),
      },
      scriptFolder: path.join(boxPath, 'scripts'),
      appName: 'demo',
      logger: { info() {}, warn() {}, error() {} },
    };
    nodeFs.mkdirSync(store.scriptFolder, { recursive: true });
  });

  afterEach(() => {
    nodeFs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('exports sync and async JSON helpers', () => {
    expect(typeof fsModule.readJSONSync).toBe('function');
    expect(typeof fsModule.writeJSONSync).toBe('function');
    expect(typeof fsModule.readJSON).toBe('function');
    expect(typeof fsModule.writeJSON).toBe('function');
  });

  test('writeJSONSync / readJSONSync round-trip', () => {
    als.run(store, () => {
      const payload = { ok: true, n: 42, nested: { a: 1 } };
      fsModule.writeJSONSync(fsModule.BOX, '/data/payload.json', payload);
      const read = fsModule.readJSONSync(fsModule.BOX, '/data/payload.json', 'utf8');
      expect(read).toEqual(payload);

      const raw = nodeFs.readFileSync(
        path.join(boxPath, 'data', 'payload.json'),
        'utf8',
      );
      expect(raw).toBe(JSON.stringify(payload, null, 2));
    });
  });

  test('writeJSON / readJSON async round-trip', async () => {
    await als.run(store, async () => {
      const payload = { async: true, items: [1, 2, 3] };
      await fsModule.writeJSON(fsModule.BOX, '/data/async.json', payload);
      const read = await fsModule.readJSON(fsModule.BOX, '/data/async.json', 'utf8');
      expect(read).toEqual(payload);
    });
  });

  test('readJSONSync throws on invalid JSON', () => {
    als.run(store, () => {
      nodeFs.mkdirSync(path.join(boxPath, 'data'), { recursive: true });
      nodeFs.writeFileSync(path.join(boxPath, 'data', 'bad.json'), '{not-json');
      expect(() =>
        fsModule.readJSONSync(fsModule.BOX, '/data/bad.json', 'utf8'),
      ).toThrow();
    });
  });
});
