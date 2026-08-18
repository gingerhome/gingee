const path = require("path");
const { als } = require("../../modules/gingee");
const { resolveSecurePath } = require("../../modules/internal_utils");
const fsModule = require("../../modules/fs"); // The module we are testing

jest.mock("fs", () => ({
  ...jest.requireActual("fs"),
  existsSync: jest.fn(() => true),
}));

describe("fs.js - Path Resolution (Unit Tests)", () => {
  let mockStore;
  beforeEach(() => {
    mockStore = {
      app: {
        id: "test_app",
        name: "test_app",
        appWebPath: path.resolve("/fake/project/web/test_app"),
        appBoxPath: path.resolve("/fake/project/web/test_app/box"),
      },
      scriptFolder: path.resolve("/fake/project/web/test_app/box/api"),
      fsScriptFolder: path.resolve("/fake/project/web/test_app/box/api"),
    };
  });

  test("relative path uses fsScriptFolder (caller script dir)", () => {
    als.run(mockStore, () => {
      const resolved = resolveSecurePath(fsModule.BOX, "./data/file.txt");
      const expected = path.resolve(
        "/fake/project/web/test_app/box/api/data/file.txt",
      );
      expect(resolved).toBe(expected);
    });
  });

  test("relative path prefers fsScriptFolder over request scriptFolder", () => {
    mockStore.scriptFolder = path.resolve(
      "/fake/project/web/test_app/box/api",
    );
    mockStore.fsScriptFolder = path.resolve(
      "/fake/project/web/test_app/box/lib",
    );
    als.run(mockStore, () => {
      const resolved = resolveSecurePath(fsModule.BOX, "data.txt");
      expect(resolved).toBe(
        path.resolve("/fake/project/web/test_app/box/lib/data.txt"),
      );
    });
  });

  test("falls back to scriptFolder when fsScriptFolder unset", () => {
    delete mockStore.fsScriptFolder;
    als.run(mockStore, () => {
      const resolved = resolveSecurePath(fsModule.BOX, "data.txt");
      expect(resolved).toBe(
        path.resolve("/fake/project/web/test_app/box/api/data.txt"),
      );
    });
  });

  test("leading slash resolves from box root", () => {
    mockStore.fsScriptFolder = path.resolve(
      "/fake/project/web/test_app/box/lib",
    );
    als.run(mockStore, () => {
      const resolved = resolveSecurePath(fsModule.BOX, "/shared/x.txt");
      expect(resolved).toBe(
        path.resolve("/fake/project/web/test_app/box/shared/x.txt"),
      );
    });
  });

  test("should throw a Path Traversal Error for malicious paths", () => {
    als.run(mockStore, () => {
      expect(() => {
        resolveSecurePath(fsModule.BOX, "../../../../danger.sh");
      }).toThrow("Path Traversal Error");
    });
  });
});
