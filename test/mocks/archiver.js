/**
 * CJS mock for ESM-only archiver (v8+) so Jest can load platform/zip tests.
 * Matches archiver v8 style: `new archiver.ZipArchive(options)`.
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
      return Promise.resolve();
    },
    pointer() {
      return 0;
    }
  };
  return instance;
}

function archiver() {
  return createInstance();
}

class ZipArchive {
  constructor() {
    return createInstance();
  }
}

archiver.ZipArchive = ZipArchive;
module.exports = archiver;
module.exports.ZipArchive = ZipArchive;
module.exports.default = archiver;
