const path = require('path');
const { als } = require('../../modules/ginger');
const { resolveSecurePath } = require('../../modules/internal_utils');
const fsModule = require('../../modules/fs'); // The module we are testing

jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => true),
}));

describe('fs.js - Path Resolution (Unit Tests)', () => {
  let mockStore;
  beforeEach(() => {
    mockStore = {
      app: {
        id: 'test_app',
        appWebPath: path.resolve('/fake/project/web/test_app'),
        appBoxPath: path.resolve('/fake/project/web/test_app/box'),
      },
      scriptFolder: path.resolve('/fake/project/web/test_app/box/api'),
    };
  });

  test('should resolve a relative path in BOX scope correctly', () => {
    als.run(mockStore, () => {
      const resolved = resolveSecurePath(fsModule.BOX, './data/file.txt');
      const expected = path.resolve('/fake/project/web/test_app/box/api/data/file.txt');
      expect(resolved).toBe(expected);
    });
  });

  test('should throw a Path Traversal Error for malicious paths', () => {
    als.run(mockStore, () => {
      expect(() => {
        resolveSecurePath(fsModule.BOX, '../../../../danger.sh');
      }).toThrow('Path Traversal Error');
    });
  });
});