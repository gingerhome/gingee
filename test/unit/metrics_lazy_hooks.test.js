/**
 * tryHandleRequest must not evaluate scrape hooks until /metrics + auth succeed.
 */
const metrics = require('../../modules/metrics');

describe('metrics lazy scrape hooks', () => {
  beforeEach(() => {
    metrics._resetForTests();
    metrics.initServer(
      { enabled: true, path: '/metrics', allow_from: ['127.0.0.1', '::1'] },
      { info() {}, warn() {}, error() {} },
    );
  });

  test('hooks thunk is not called for non-metrics paths', () => {
    const hooksFn = jest.fn(() => ({
      limitsStats: { globalInFlight: 0, outboundInFlight: 0, appInFlight: {} },
      appsCount: 1,
      schedulerJobs: 0,
    }));
    const req = {
      url: '/glade/login.html',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    };
    const res = { writeHead: jest.fn(), end: jest.fn() };
    expect(metrics.tryHandleRequest(req, res, hooksFn)).toBe(false);
    expect(hooksFn).not.toHaveBeenCalled();
  });

  test('hooks thunk runs only after path match and auth', () => {
    const hooksFn = jest.fn(() => ({
      limitsStats: { globalInFlight: 0, outboundInFlight: 0, appInFlight: {} },
      appsCount: 2,
      schedulerJobs: 3,
    }));
    const req = {
      url: '/metrics',
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    };
    let body = '';
    const res = {
      writeHead: jest.fn(),
      end: (b) => {
        body = String(b);
      },
    };
    expect(metrics.tryHandleRequest(req, res, hooksFn)).toBe(true);
    expect(hooksFn).toHaveBeenCalledTimes(1);
    expect(body).toContain('gingee_apps_registered');
  });

  test('hooks thunk not called when scrape is forbidden', () => {
    const hooksFn = jest.fn(() => ({}));
    const req = {
      url: '/metrics',
      socket: { remoteAddress: '8.8.8.8' },
      headers: {},
    };
    const res = { writeHead: jest.fn(), end: jest.fn() };
    expect(metrics.tryHandleRequest(req, res, hooksFn)).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
    expect(hooksFn).not.toHaveBeenCalled();
  });
});
