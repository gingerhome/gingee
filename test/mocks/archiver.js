/**
 * CJS mock for archiver v8+ (ESM-only package).
 * Production API: `new archiver.ZipArchive(options)` — not `archiver('zip', options)`.
 */

function createInstance() {
  const handlers = {};
  const instance = {
    on(event, cb) {
      handlers[event] = cb;
      return instance;
    },
    pipe() {
      return instance;
    },
    append() {
      return instance;
    },
    directory() {
      return instance;
    },
    file() {
      return instance;
    },
    finalize() {
      if (handlers.finish) setImmediate(handlers.finish);
      if (handlers.end) setImmediate(handlers.end);
      return Promise.resolve();
    },
    pointer() {
      return 0;
    }
  };
  return instance;
}

class ZipArchive {
  constructor(_options) {
    return createInstance();
  }
}

// Namespace-style export matching real archiver v8 require()
const archiver = {
  ZipArchive,
  Archiver: ZipArchive,
  TarArchive: ZipArchive,
  JsonArchive: ZipArchive
};

module.exports = archiver;
module.exports.ZipArchive = ZipArchive;
module.exports.default = archiver;
