const {
  shouldIsolateApp,
  resolveWorkerKey,
  appsForWorker,
  restartDelayMs,
  ISOLATION_DEFAULTS
} = require('../../modules/engine/isolation/policy');

describe('isolation policy', () => {
  test('defaults mode is off and auto_restart on', () => {
    expect(ISOLATION_DEFAULTS.mode).toBe('off');
    expect(ISOLATION_DEFAULTS.auto_restart).toBe(true);
    expect(ISOLATION_DEFAULTS.restart_max).toBe(10);
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

  test('group membership isolates and shares worker key', () => {
    const cfg = {
      isolation: {
        mode: 'process',
        default: 'inprocess',
        apps: [],
        groups: { shared: ['a', 'b'] }
      },
      privileged_apps: []
    };
    const a = { name: 'a', config: {} };
    const b = { name: 'b', config: {} };
    expect(shouldIsolateApp(a, cfg)).toBe(true);
    expect(resolveWorkerKey(a, cfg)).toBe('group:shared');
    expect(resolveWorkerKey(b, cfg)).toBe('group:shared');
    expect(appsForWorker(a, cfg, { a, b })).toEqual(['a', 'b']);
  });

  test('restartDelayMs backs off', () => {
    const iso = { restart_delay_ms: 100, restart_backoff_max_ms: 1000 };
    expect(restartDelayMs(0, iso)).toBe(100);
    expect(restartDelayMs(1, iso)).toBe(200);
    expect(restartDelayMs(10, iso)).toBe(1000);
  });
});
