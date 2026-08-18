/**
 * Caller-relative fs via gbox — run under a real Node child because Jest's VM
 * interaction can drop AsyncLocalStorage across vm.runInContext callbacks.
 */
const path = require('path');
const { spawnSync } = require('child_process');

describe('fs caller-relative via runInGBox', () => {
  test('nested lib + override wrapper path bases', () => {
    const script = path.join(__dirname, 'fs_caller_relative_gbox.harness.js');
    const r = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      cwd: path.join(__dirname, '..', '..'),
    });
    if (r.status !== 0) {
      throw new Error(
        `harness failed (status ${r.status}):\n${r.stdout}\n${r.stderr}`,
      );
    }
    const lines = r.stdout
      .trim()
      .split(/\r?\n/)
      .filter(Boolean);
    expect(lines).toContain('NESTED_OK');
    expect(lines).toContain('OVERRIDE_OK');
  });
});
