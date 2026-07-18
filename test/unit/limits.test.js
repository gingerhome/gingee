const limits = require('../../modules/limits');

describe('limits.js', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    limits._resetForTests();
    limits.initServer(
      {
        request_timeout_ms: 30000,
        outbound_timeout_ms: 15000,
        max_concurrent_requests: 3,
        max_concurrent_requests_per_app: 2,
        max_concurrent_outbound: 2
      },
      logger
    );
  });

  afterEach(() => {
    limits._resetForTests();
  });

  test('resolveForApp tightens only (cannot raise above server)', () => {
    const app = {
      name: 'a',
      config: {
        limits: {
          request_timeout_ms: 10000,
          outbound_timeout_ms: 60000, // try to raise
          max_concurrent_requests: 1
        }
      }
    };
    const lim = limits.resolveForApp(app);
    expect(lim.request_timeout_ms).toBe(10000);
    expect(lim.outbound_timeout_ms).toBe(15000); // clamped to server
    expect(lim.max_concurrent_requests_per_app).toBe(1);
  });

  test('tryAcquireRequest enforces global and per-app caps', () => {
    const app = { name: 'app1', config: {} };
    const t1 = limits.tryAcquireRequest('app1', app);
    const t2 = limits.tryAcquireRequest('app1', app);
    expect(t1.ok).toBe(true);
    expect(t2.ok).toBe(true);

    const t3 = limits.tryAcquireRequest('app1', app);
    expect(t3.ok).toBe(false);
    expect(t3.scope).toBe('app');

    limits.releaseRequest(t1.token);
    const t4 = limits.tryAcquireRequest('app1', app);
    expect(t4.ok).toBe(true);

    // Fill global with another app
    const app2 = { name: 'app2', config: {} };
    const a = limits.tryAcquireRequest('app2', app2);
    expect(a.ok).toBe(true);
    // global max 3: app1 has 2 (t2,t4), app2 has 1 → full
    const b = limits.tryAcquireRequest('app2', app2);
    expect(b.ok).toBe(false);
    expect(b.scope).toBe('global');

    limits.releaseRequest(t2.token);
    limits.releaseRequest(t4.token);
    limits.releaseRequest(a.token);
  });

  test('releaseRequest is idempotent', () => {
    const app = { name: 'x', config: {} };
    const t = limits.tryAcquireRequest('x', app);
    limits.releaseRequest(t.token);
    limits.releaseRequest(t.token);
    expect(limits.getStats().globalInFlight).toBe(0);
  });

  test('resolveOutboundTimeoutMs uses default and clamps to remaining budget', () => {
    const store = {
      limitsConfig: limits.resolveForApp({ config: {} }),
      requestDeadline: Date.now() + 5000,
      $g: { isStreaming: false }
    };
    expect(limits.resolveOutboundTimeoutMs(undefined, store)).toBe(5000);
    expect(limits.resolveOutboundTimeoutMs(2000, store)).toBe(2000);
    expect(limits.resolveOutboundTimeoutMs(999999, store)).toBe(5000);
  });

  test('tryAcquireOutbound enforces max_concurrent_outbound', () => {
    const a = limits.tryAcquireOutbound();
    const b = limits.tryAcquireOutbound();
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    const c = limits.tryAcquireOutbound();
    expect(c.ok).toBe(false);
    a.release();
    const d = limits.tryAcquireOutbound();
    expect(d.ok).toBe(true);
    b.release();
    d.release();
  });

  test('attachRequestContext sets abort signal and deadline', () => {
    const app = { name: 't', config: {} };
    const acq = limits.tryAcquireRequest('t', app);
    const store = { appName: 't', app, logger, req: { url: '/t/x' } };
    const res = { on: jest.fn(), headersSent: false, writableEnded: false };
    limits.attachRequestContext(store, acq.token, res);
    expect(store.requestAbortSignal).toBeDefined();
    expect(store.requestDeadline).toBeGreaterThan(Date.now());
    expect(res.on).toHaveBeenCalled();
    limits.clearRequestTimers(store);
    limits.releaseRequest(acq.token);
  });
});
