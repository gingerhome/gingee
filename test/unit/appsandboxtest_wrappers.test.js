/**
 * Identity tags used by appsandboxtest module_override / local_modules sample modules.
 */
const helperOriginal = require('../../web/appsandboxtest/box/sandboxed/helper.js');
const helperWrap = require('../../web/appsandboxtest/box/library/helper_wrap.js');
const bareOriginal = require('../../web/appsandboxtest/box/shared/bare_util.js');
const bareWrap = require('../../web/appsandboxtest/box/library/bare_util_wrap.js');
const normalHelper = require('../../web/appsandboxtest/box/normal/helper.js');
const sandboxKit = require('../../local_modules/sandbox_kit.js');

describe('appsandboxtest override sample modules', () => {
  test('relative helper original vs wrap differ', () => {
    expect(helperOriginal.whoami).toBe('sandboxed/helper');
    expect(helperWrap.whoami).toBe('library/helper_wrap');
    expect(helperOriginal.greet('x')).toContain('sandboxed-helper');
    expect(helperWrap.greet('x')).toContain('helper-wrap');
  });

  test('box-root bare_util original vs wrap differ', () => {
    expect(bareOriginal.whoami).toBe('shared/bare_util');
    expect(bareWrap.whoami).toBe('library/bare_util_wrap');
    expect(bareOriginal.ping()).toBe('pong-from-shared-bare-util');
    expect(bareWrap.ping()).toBe('pong-from-bare-util-wrap');
  });

  test('normal helper is distinct from sandboxed helper', () => {
    expect(normalHelper.whoami).toBe('normal/helper');
    expect(normalHelper.kind).toBe('relative-original');
  });

  test('project local_modules sandbox_kit identity', () => {
    expect(sandboxKit.whoami).toBe('local_modules/sandbox_kit');
    expect(sandboxKit.kind).toBe('project-local');
    expect(sandboxKit.label('x')).toBe('x:sandbox_kit');
  });
});
