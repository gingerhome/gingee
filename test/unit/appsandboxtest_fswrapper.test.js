/**
 * Path jail helper used by appsandboxtest library/fswrapper.
 */
const wrapper = require('../../web/appsandboxtest/box/library/fswrapper.js');

describe('appsandboxtest fswrapper path jail', () => {
  const isUnder = wrapper._isUnderSandboxedFolder;

  test('allows relative paths that stay under sandboxed/', () => {
    expect(isUnder('from-sandboxed.txt')).toBe(true);
    expect(isUnder('sub/dir/file.txt')).toBe(true);
    expect(isUnder('./x.txt')).toBe(true);
  });

  test('allows box-root paths under /sandboxed', () => {
    expect(isUnder('/sandboxed/x.txt')).toBe(true);
    expect(isUnder('/sandboxed')).toBe(true);
  });

  test('rejects escape to normal/ and other box roots', () => {
    expect(isUnder('../normal/escape.txt')).toBe(false);
    expect(isUnder('../../outside.txt')).toBe(false);
    expect(isUnder('/normal/x.txt')).toBe(false);
    expect(isUnder('/sandboxed/../normal/x.txt')).toBe(false);
  });
});
