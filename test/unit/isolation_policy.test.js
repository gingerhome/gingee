const {
  shouldIsolateApp,
  ISOLATION_DEFAULTS
} = require('../../modules/engine/isolation/policy');

describe('isolation policy', () => {
  test('defaults mode is off', () => {
    expect(ISOLATION_DEFAULTS.mode).toBe('off');
  });

  test('mode off never isolates', () => {
    const app = { name: 'demo', config: { isolation: 'process' } };
    expect(shouldIsolateApp(app, { isolation: { mode: 'off' }, privileged_apps: [] })).toBe(
      false
    );
  });

  test('privileged apps never isolate', () => {
    const app = { name: 'glade', config: { isolation: 'process' } };
    expect(
      shouldIsolateApp(app, {
        isolation: { mode: 'process', default: 'process', apps: [] },
        privileged_apps: ['glade']
      })
    ).toBe(false);
  });

  test('app.json isolation process wins when mode process', () => {
    const app = { name: 'demo', config: { isolation: 'process' } };
    expect(
      shouldIsolateApp(app, {
        isolation: { mode: 'process', default: 'inprocess', apps: [] },
        privileged_apps: ['glade']
      })
    ).toBe(true);
  });

  test('apps allowlist isolates named apps', () => {
    const app = { name: 'demo', config: {} };
    expect(
      shouldIsolateApp(app, {
        isolation: { mode: 'process', default: 'inprocess', apps: ['demo'] },
        privileged_apps: []
      })
    ).toBe(true);
  });

  test('default process isolates unmarked apps', () => {
    const app = { name: 'demo', config: {} };
    expect(
      shouldIsolateApp(app, {
        isolation: { mode: 'process', default: 'process', apps: [] },
        privileged_apps: []
      })
    ).toBe(true);
  });
});
