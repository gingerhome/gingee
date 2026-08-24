const EventEmitter = require("events");
const archiver = require("archiver");
const yauzl = require("yauzl");
const { als } = require("../../modules/gingee");
const fs = require("../../modules/fs"); // The secure fs wrapper
const nodeFs = require("fs"); // The native fs
const zip = require("../../modules/zip");
const {
  resolveSecurePath,
  isPathInside,
} = require("../../modules/internal_utils");

// Mock the libraries and modules
jest.mock("archiver");
jest.mock("yauzl");
jest.mock("../../modules/fs");
jest.mock("fs");
jest.mock("../../modules/internal_utils");

describe("zip.js - Archive Utilities", () => {
  let mockArchive;
  let mockZipFile;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create a mock archiver instance
    mockArchive = {
      on: jest.fn((event, cb) => {
        if (event === "data") {
          cb(Buffer.from("mock zip data"));
        } else if (event === "end") {
          cb();
        }
        return mockArchive;
      }),
      pipe: jest.fn(),
      directory: jest.fn(),
      file: jest.fn(),
      finalize: jest.fn().mockResolvedValue(),
    };
    // archiver v8 uses ZipArchive constructor; support both mock styles
    if (typeof archiver.mockReturnValue === "function") {
      archiver.mockReturnValue(mockArchive);
    }
    if (archiver.ZipArchive) {
      archiver.ZipArchive = jest.fn().mockImplementation(() => mockArchive);
    }

    // Create a mock yauzl ZipFile instance
    mockZipFile = new EventEmitter();
    mockZipFile.close = jest.fn();
    mockZipFile.readEntry = jest.fn();
    mockZipFile.openReadStream = jest.fn();

    yauzl.open = jest.fn((sourcePath, options, callback) => {
      callback(null, mockZipFile);
    });

    // Use the real module's constants
    fs.BOX = "BOX";
    fs.WEB = "WEB";

    // Mock the return of our secure path resolver
    resolveSecurePath.mockImplementation((scope, p) => `/secure/${scope}/${p}`);
    isPathInside.mockImplementation(() => true);
  });

  describe("zip", () => {
    test("should zip a directory into a buffer", async () => {
      nodeFs.statSync.mockReturnValue({ isDirectory: () => true });

      let buffer;
      await als.run({}, async () => {
        buffer = await zip.zip(fs.BOX, "my_folder", {
          includeRootFolder: true,
        });
      });

      expect(resolveSecurePath).toHaveBeenCalledWith(fs.BOX, "my_folder");
      expect(mockArchive.directory).toHaveBeenCalledWith(
        "/secure/BOX/my_folder",
        "my_folder",
      );
      expect(mockArchive.finalize).toHaveBeenCalled();
      expect(buffer).toEqual(Buffer.from("mock zip data"));
    });

    test("should zip a file into a buffer", async () => {
      nodeFs.statSync.mockReturnValue({ isDirectory: () => false });

      let buffer;
      await als.run({}, async () => {
        buffer = await zip.zip(fs.BOX, "file.txt");
      });

      expect(resolveSecurePath).toHaveBeenCalledWith(fs.BOX, "file.txt");
      expect(mockArchive.file).toHaveBeenCalledWith("/secure/BOX/file.txt", {
        name: "file.txt",
      });
      expect(mockArchive.finalize).toHaveBeenCalled();
      expect(buffer).toEqual(Buffer.from("mock zip data"));
    });
  });

  describe("zipToFile", () => {
    test("should throw if source file or directory does not exist", async () => {
      nodeFs.existsSync.mockReturnValue(false);

      await expect(
        als.run({}, async () => {
          await zip.zipToFile(fs.BOX, "missing", fs.BOX, "dest.zip");
        }),
      ).rejects.toThrow("Source file or directory does not exist: missing");
    });

    test("should zip a directory to a file with the correct paths", async () => {
      nodeFs.statSync.mockReturnValue({ isDirectory: () => true });
      nodeFs.existsSync.mockReturnValue(true);

      const mockWriteStream = {
        on: jest.fn((event, callback) => {
          if (event === "close") {
            callback();
          }
          return mockWriteStream;
        }),
        pipe: jest.fn(),
      };
      nodeFs.createWriteStream.mockReturnValue(mockWriteStream);

      await als.run({}, async () => {
        await zip.zipToFile(fs.BOX, "my_folder", fs.BOX, "archive.zip");
      });

      expect(resolveSecurePath).toHaveBeenCalledWith(fs.BOX, "my_folder");
      expect(mockArchive.directory).toHaveBeenCalledWith(
        "/secure/BOX/my_folder",
        false,
      );
    });

    test("should zip a file when source is not a directory", async () => {
      nodeFs.statSync.mockReturnValue({ isDirectory: () => false });
      nodeFs.existsSync.mockReturnValue(true);

      const mockWriteStream = {
        on: jest.fn((event, callback) => {
          if (event === "close") {
            callback();
          }
          return mockWriteStream;
        }),
        pipe: jest.fn(),
      };
      nodeFs.createWriteStream.mockReturnValue(mockWriteStream);

      await als.run({}, async () => {
        await zip.zipToFile(fs.BOX, "data.json", fs.BOX, "data.zip");
      });

      expect(resolveSecurePath).toHaveBeenCalledWith(fs.BOX, "data.json");
      expect(mockArchive.file).toHaveBeenCalledWith("/secure/BOX/data.json", {
        name: "data.json",
      });
    });
  });

  describe("unzip", () => {
    test("should throw if source zip file does not exist", async () => {
      nodeFs.existsSync.mockReturnValue(false);

      await expect(
        als.run({}, async () => {
          await zip.unzip(fs.WEB, "archive.zip", fs.WEB, "output_folder");
        }),
      ).rejects.toThrow("Source zip file does not exist: archive.zip");
    });

    test("should extract directory and file entries using yauzl", async () => {
      nodeFs.existsSync.mockReturnValue(true);

      const entries = [
        { fileName: "subdir/" },
        { fileName: "subdir/hello.txt" },
      ];

      let entryIndex = 0;
      mockZipFile.readEntry.mockImplementation(() => {
        process.nextTick(() => {
          if (entryIndex < entries.length) {
            const entry = entries[entryIndex++];
            mockZipFile.emit("entry", entry);
          } else {
            mockZipFile.emit("end");
          }
        });
      });

      mockZipFile.openReadStream.mockImplementation((entry, callback) => {
        const mockReadStream = new EventEmitter();
        mockReadStream.pipe = jest.fn((dest) => {
          process.nextTick(() => {
            dest.emit("finish");
          });
          return dest;
        });
        callback(null, mockReadStream);
      });

      const mockWriteStream = new EventEmitter();
      nodeFs.createWriteStream.mockReturnValue(mockWriteStream);

      await als.run({}, async () => {
        await zip.unzip(fs.WEB, "archive.zip", fs.WEB, "output_folder");
      });

      expect(resolveSecurePath).toHaveBeenCalledWith(fs.WEB, "archive.zip");
      expect(resolveSecurePath).toHaveBeenCalledWith(fs.WEB, "output_folder");
      expect(yauzl.open).toHaveBeenCalledWith(
        "/secure/WEB/archive.zip",
        { lazyEntries: true },
        expect.any(Function),
      );
      expect(nodeFs.mkdirSync).toHaveBeenCalledWith(
        "/secure/WEB/output_folder",
        { recursive: true },
      );
      expect(mockZipFile.openReadStream).toHaveBeenCalledWith(
        { fileName: "subdir/hello.txt" },
        expect.any(Function),
      );
    });

    test("should reject with security error on path traversal entry and close zipfile", async () => {
      nodeFs.existsSync.mockReturnValue(true);
      isPathInside.mockReturnValue(false); // Fails containment check

      mockZipFile.readEntry.mockImplementation(() => {
        process.nextTick(() => {
          mockZipFile.emit("entry", { fileName: "../../etc/passwd" });
        });
      });

      await expect(
        als.run({}, async () => {
          await zip.unzip(fs.WEB, "archive.zip", fs.WEB, "output_folder");
        }),
      ).rejects.toThrow(
        "Security Error: Zip file contains path traversal ('../../etc/passwd').",
      );

      expect(mockZipFile.close).toHaveBeenCalled();
    });

    test("should reject if yauzl.open fails", async () => {
      nodeFs.existsSync.mockReturnValue(true);
      yauzl.open.mockImplementation((sourcePath, options, callback) => {
        callback(new Error("Corrupt zip header"));
      });

      await expect(
        als.run({}, async () => {
          await zip.unzip(fs.WEB, "archive.zip", fs.WEB, "output_folder");
        }),
      ).rejects.toThrow("Corrupt zip header");
    });

    test("should reject if zipfile emits error", async () => {
      nodeFs.existsSync.mockReturnValue(true);

      mockZipFile.readEntry.mockImplementation(() => {
        process.nextTick(() => {
          mockZipFile.emit("error", new Error("CRC check failed"));
        });
      });

      await expect(
        als.run({}, async () => {
          await zip.unzip(fs.WEB, "archive.zip", fs.WEB, "output_folder");
        }),
      ).rejects.toThrow("CRC check failed");
    });

    test("should reject and close zipfile if openReadStream fails", async () => {
      nodeFs.existsSync.mockReturnValue(true);

      mockZipFile.readEntry.mockImplementation(() => {
        process.nextTick(() => {
          mockZipFile.emit("entry", { fileName: "file.txt" });
        });
      });

      mockZipFile.openReadStream.mockImplementation((entry, callback) => {
        callback(new Error("Decompression error"));
      });

      await expect(
        als.run({}, async () => {
          await zip.unzip(fs.WEB, "archive.zip", fs.WEB, "output_folder");
        }),
      ).rejects.toThrow("Decompression error");

      expect(mockZipFile.close).toHaveBeenCalled();
    });

    test("should reject and close zipfile if writeStream emits error", async () => {
      nodeFs.existsSync.mockReturnValue(true);

      mockZipFile.readEntry.mockImplementation(() => {
        process.nextTick(() => {
          mockZipFile.emit("entry", { fileName: "file.txt" });
        });
      });

      const mockReadStream = new EventEmitter();
      mockReadStream.pipe = jest.fn((dest) => {
        process.nextTick(() => {
          dest.emit("error", new Error("Disk full"));
        });
        return dest;
      });
      mockZipFile.openReadStream.mockImplementation((entry, callback) => {
        callback(null, mockReadStream);
      });

      const mockWriteStream = new EventEmitter();
      nodeFs.createWriteStream.mockReturnValue(mockWriteStream);

      await expect(
        als.run({}, async () => {
          await zip.unzip(fs.WEB, "archive.zip", fs.WEB, "output_folder");
        }),
      ).rejects.toThrow("Disk full");

      expect(mockZipFile.close).toHaveBeenCalled();
    });

    test("should reject and close zipfile if readStream emits error", async () => {
      nodeFs.existsSync.mockReturnValue(true);

      mockZipFile.readEntry.mockImplementation(() => {
        process.nextTick(() => {
          mockZipFile.emit("entry", { fileName: "file.txt" });
        });
      });

      const mockReadStream = new EventEmitter();
      mockReadStream.pipe = jest.fn((dest) => {
        process.nextTick(() => {
          mockReadStream.emit("error", new Error("Corrupt stream"));
        });
        return dest;
      });
      mockZipFile.openReadStream.mockImplementation((entry, callback) => {
        callback(null, mockReadStream);
      });

      const mockWriteStream = new EventEmitter();
      nodeFs.createWriteStream.mockReturnValue(mockWriteStream);

      await expect(
        als.run({}, async () => {
          await zip.unzip(fs.WEB, "archive.zip", fs.WEB, "output_folder");
        }),
      ).rejects.toThrow("Corrupt stream");

      expect(mockZipFile.close).toHaveBeenCalled();
    });
  });
});
