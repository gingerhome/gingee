/**
 * fs listing / walk / stat APIs (real temp dirs under ALS context).
 */
const path = require('path');
const os = require('os');
const nodeFs = require('fs');
const { als } = require('../../modules/gingee');
const fsModule = require('../../modules/fs');

describe('fs list / walk / stat', () => {
  let tmpRoot;
  let boxPath;
  let store;

  beforeEach(() => {
    tmpRoot = nodeFs.mkdtempSync(path.join(os.tmpdir(), 'gingee-fs-list-'));
    boxPath = path.join(tmpRoot, 'box');
    nodeFs.mkdirSync(path.join(boxPath, 'data', 'sub'), { recursive: true });
    nodeFs.writeFileSync(path.join(boxPath, 'data', 'a.txt'), 'aaa');
    nodeFs.writeFileSync(path.join(boxPath, 'data', 'b.txt'), 'bb');
    nodeFs.writeFileSync(path.join(boxPath, 'data', 'sub', 'c.txt'), 'c');
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

  test('readdirSync / listFilesSync / listDirsSync', () => {
    als.run(store, () => {
      const all = fsModule.readdirSync(fsModule.BOX, '/data').sort();
      expect(all).toEqual(['a.txt', 'b.txt', 'sub']);
      expect(fsModule.listFilesSync(fsModule.BOX, '/data').sort()).toEqual([
        'a.txt',
        'b.txt',
      ]);
      expect(fsModule.listDirsSync(fsModule.BOX, '/data')).toEqual(['sub']);
    });
  });

  test('walkSync files and includeDirs / maxDepth', () => {
    als.run(store, () => {
      const files = fsModule.walkSync(fsModule.BOX, '/data').sort();
      expect(files).toEqual(['a.txt', 'b.txt', 'sub/c.txt']);

      const withDirs = fsModule
        .walkSync(fsModule.BOX, '/data', { includeDirs: true })
        .sort();
      expect(withDirs).toEqual(['a.txt', 'b.txt', 'sub', 'sub/c.txt']);

      const depth1 = fsModule.walkSync(fsModule.BOX, '/data', { maxDepth: 1 }).sort();
      expect(depth1).toEqual(['a.txt', 'b.txt']);
    });
  });

  test('statSync on file and directory', () => {
    als.run(store, () => {
      const fileStat = fsModule.statSync(fsModule.BOX, '/data/a.txt');
      expect(fileStat.isFile).toBe(true);
      expect(fileStat.isDirectory).toBe(false);
      expect(fileStat.size).toBe(3);

      const dirStat = fsModule.statSync(fsModule.BOX, '/data');
      expect(dirStat.isDirectory).toBe(true);
      expect(dirStat.isFile).toBe(false);
    });
  });

  test('async readdir / listFiles / listDirs / walk / stat', async () => {
    await als.run(store, async () => {
      expect((await fsModule.readdir(fsModule.BOX, '/data')).sort()).toEqual([
        'a.txt',
        'b.txt',
        'sub',
      ]);
      expect((await fsModule.listFiles(fsModule.BOX, '/data')).sort()).toEqual([
        'a.txt',
        'b.txt',
      ]);
      expect(await fsModule.listDirs(fsModule.BOX, '/data')).toEqual(['sub']);
      expect((await fsModule.walk(fsModule.BOX, '/data')).sort()).toEqual([
        'a.txt',
        'b.txt',
        'sub/c.txt',
      ]);
      const st = await fsModule.stat(fsModule.BOX, '/data/b.txt');
      expect(st.isFile).toBe(true);
      expect(st.size).toBe(2);
    });
  });

  test('statSync throws for missing path', () => {
    als.run(store, () => {
      expect(() => fsModule.statSync(fsModule.BOX, '/data/missing.txt')).toThrow();
    });
  });
});
