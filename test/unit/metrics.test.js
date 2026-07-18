const metrics = require('../../modules/metrics');

describe('metrics.js', () => {
  beforeEach(() => {
    metrics._resetForTests();
    metrics.initServer(
      {
        enabled: true,
        path: '/metrics',
        allow_from: ['127.0.0.1', '::1', '::ffff:127.0.0.1'],
        bearer_token: null
      },
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      '1.2.3-test'
    );
  });

  afterEach(() => {
    metrics._resetForTests();
  });

  test('inc and setGauge appear in Prometheus text', () => {
    metrics.inc('gingee_http_requests_total', { app: 'demo', kind: 'script', status_class: '2xx' });
    metrics.setGauge('gingee_apps_registered', {}, 4);
    const text = metrics.renderPrometheus();
    expect(text).toMatch(/gingee_http_requests_total\{.*app="demo".*\} 1/);
    expect(text).toMatch(/gingee_apps_registered 4/);
    expect(text).toMatch(/gingee_build_info\{version="1.2.3-test"\} 1/);
    expect(text).toMatch(/gingee_up 1/);
  });

  test('observe builds histogram buckets', () => {
    metrics.observe('gingee_http_request_duration_seconds', { app: 'a', kind: 'script' }, 0.02);
    metrics.observe('gingee_http_request_duration_seconds', { app: 'a', kind: 'script' }, 1.5);
    const text = metrics.renderPrometheus();
    expect(text).toMatch(/gingee_http_request_duration_seconds_count\{app="a",kind="script"\} 2/);
    expect(text).toMatch(/gingee_http_request_duration_seconds_sum\{app="a",kind="script"\} /);
    expect(text).toMatch(/le="\+Inf"/);
  });

  test('recordHttpRequest increments counter and observes duration', () => {
    metrics.recordHttpRequest({
      app: 'tests',
      kind: 'script',
      statusCode: 200,
      durationSeconds: 0.01
    });
    const text = metrics.renderPrometheus();
    expect(text).toMatch(/status_class="2xx"/);
    expect(text).toMatch(/gingee_http_request_duration_seconds_count/);
  });

  test('statusClass maps ranges', () => {
    expect(metrics.statusClass(201)).toBe('2xx');
    expect(metrics.statusClass(302)).toBe('3xx');
    expect(metrics.statusClass(404)).toBe('4xx');
    expect(metrics.statusClass(503)).toBe('5xx');
    expect(metrics.statusClass(NaN)).toBe('unknown');
  });

  test('isAllowedRemote respects allow_from and empty list', () => {
    expect(metrics.isAllowedRemote('127.0.0.1')).toBe(true);
    expect(metrics.isAllowedRemote('::1')).toBe(true);
    expect(metrics.isAllowedRemote('10.0.0.5')).toBe(false);

    metrics.initServer(
      { enabled: true, path: '/metrics', allow_from: [] },
      { info: jest.fn() },
      'x'
    );
    expect(metrics.isAllowedRemote('10.0.0.5')).toBe(true);
  });

  test('tryHandleRequest serves metrics for localhost and 403 for others', () => {
    const reqOk = {
      url: '/metrics',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' }
    };
    const resOk = {
      writeHead: jest.fn(),
      end: jest.fn()
    };
    expect(metrics.tryHandleRequest(reqOk, resOk)).toBe(true);
    expect(resOk.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'Content-Type': expect.stringContaining('text/plain') })
    );
    expect(String(resOk.end.mock.calls[0][0])).toMatch(/gingee_up/);

    const reqBad = {
      url: '/metrics',
      headers: {},
      socket: { remoteAddress: '8.8.8.8' }
    };
    const resBad = { writeHead: jest.fn(), end: jest.fn() };
    expect(metrics.tryHandleRequest(reqBad, resBad)).toBe(true);
    expect(resBad.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });

  test('tryHandleRequest returns false for other paths or when disabled', () => {
    const req = {
      url: '/health',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' }
    };
    const res = { writeHead: jest.fn(), end: jest.fn() };
    expect(metrics.tryHandleRequest(req, res)).toBe(false);

    metrics.initServer({ enabled: false }, { info: jest.fn() }, 'x');
    const reqM = {
      url: '/metrics',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' }
    };
    expect(metrics.tryHandleRequest(reqM, res)).toBe(false);
  });

  test('bearer_token is required when configured', () => {
    metrics.initServer(
      {
        enabled: true,
        path: '/metrics',
        allow_from: ['127.0.0.1'],
        bearer_token: 's3cret'
      },
      { info: jest.fn() },
      'x'
    );
    const res = { writeHead: jest.fn(), end: jest.fn() };
    const noAuth = {
      url: '/metrics',
      headers: {},
      socket: { remoteAddress: '127.0.0.1' }
    };
    expect(metrics.tryHandleRequest(noAuth, res)).toBe(true);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));

    const withAuth = {
      url: '/metrics',
      headers: { authorization: 'Bearer s3cret' },
      socket: { remoteAddress: '127.0.0.1' }
    };
    const res2 = { writeHead: jest.fn(), end: jest.fn() };
    expect(metrics.tryHandleRequest(withAuth, res2)).toBe(true);
    expect(res2.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
  });

  test('does not trust X-Forwarded-For for allow_from', () => {
    const req = {
      url: '/metrics',
      headers: { 'x-forwarded-for': '127.0.0.1' },
      socket: { remoteAddress: '8.8.8.8' }
    };
    const res = { writeHead: jest.fn(), end: jest.fn() };
    metrics.tryHandleRequest(req, res);
    expect(res.writeHead).toHaveBeenCalledWith(403, expect.any(Object));
  });

  test('refreshDynamicGauges uses hooks', () => {
    const text = metrics.renderPrometheus({
      limitsStats: {
        globalInFlight: 3,
        outboundInFlight: 1,
        appInFlight: { demo: 2 }
      },
      appsCount: 5,
      schedulerJobs: 7
    });
    expect(text).toMatch(/gingee_limits_inflight_requests 3/);
    expect(text).toMatch(/gingee_limits_inflight_outbound 1/);
    expect(text).toMatch(/gingee_limits_inflight_requests_by_app\{app="demo"\} 2/);
    expect(text).toMatch(/gingee_apps_registered 5/);
    expect(text).toMatch(/gingee_scheduler_jobs_registered 7/);
  });
});
