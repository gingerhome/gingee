const egress = require('../../modules/egress');

describe('egress.js SSRF policy', () => {
  const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };

  beforeEach(() => {
    egress._resetForTests();
    egress.initServer(
      {
        mode: 'protected',
        dns_check: false,
        https_only: false,
        max_redirects: 3
      },
      logger
    );
  });

  afterEach(() => {
    egress._resetForTests();
  });

  describe('classifyIp', () => {
    test('classifies loopback, private, link-local, public', () => {
      expect(egress.classifyIp('127.0.0.1').kind).toBe('loopback');
      expect(egress.classifyIp('10.0.0.5').kind).toBe('private');
      expect(egress.classifyIp('192.168.1.1').kind).toBe('private');
      expect(egress.classifyIp('172.16.0.1').kind).toBe('private');
      expect(egress.classifyIp('169.254.169.254').kind).toBe('link_local');
      expect(egress.classifyIp('8.8.8.8').kind).toBe('public');
      expect(egress.classifyIp('::1').kind).toBe('loopback');
      expect(egress.classifyIp('::ffff:127.0.0.1').kind).toBe('loopback');
    });
  });

  describe('assertUrlAllowed (protected, no DNS)', () => {
    test('allows public https host', async () => {
      const r = await egress.assertUrlAllowed('https://postman-echo.com/get');
      expect(r.ok).toBe(true);
    });

    test('denies loopback', async () => {
      const r = await egress.assertUrlAllowed('http://127.0.0.1:8080/admin');
      expect(r.ok).toBe(false);
      expect(r.code).toBe('EGRESS_DENIED');
      expect(r.reason).toBe('BLOCKED_LOOPBACK');
    });

    test('denies private IP', async () => {
      const r = await egress.assertUrlAllowed('http://10.1.2.3/secret');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('BLOCKED_PRIVATE');
    });

    test('denies metadata IP and hostname', async () => {
      const ip = await egress.assertUrlAllowed('http://169.254.169.254/latest/meta-data');
      expect(ip.ok).toBe(false);
      expect(['BLOCKED_LINK_LOCAL', 'BLOCKED_METADATA']).toContain(ip.reason);

      const host = await egress.assertUrlAllowed('http://metadata.google.internal/');
      expect(host.ok).toBe(false);
      expect(host.reason).toBe('BLOCKED_METADATA');
    });

    test('denies non-http schemes', async () => {
      const r = await egress.assertUrlAllowed('file:///etc/passwd');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('SCHEME');
    });

    test('denies userinfo in URL', async () => {
      const r = await egress.assertUrlAllowed('https://user:pass@example.com/');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('USERINFO');
    });

    test('allow_cidrs can open a private range', async () => {
      egress.initServer(
        {
          mode: 'protected',
          dns_check: false,
          allow_cidrs: ['10.0.0.0/8']
        },
        logger
      );
      const r = await egress.assertUrlAllowed('http://10.9.9.9/health');
      expect(r.ok).toBe(true);
    });
  });

  describe('mode allowlist', () => {
    test('only allowlisted hosts pass', async () => {
      egress.initServer(
        {
          mode: 'allowlist',
          dns_check: false,
          allow_hosts: ['api.example.com', '*.trusted.test']
        },
        logger
      );
      expect((await egress.assertUrlAllowed('https://api.example.com/v1')).ok).toBe(true);
      expect((await egress.assertUrlAllowed('https://a.trusted.test/x')).ok).toBe(true);
      expect((await egress.assertUrlAllowed('https://evil.com/')).ok).toBe(false);
      // metadata still blocked
      expect((await egress.assertUrlAllowed('http://metadata.google.internal/')).ok).toBe(false);
    });
  });

  describe('mode off', () => {
    test('allows private and metadata when off', async () => {
      egress.initServer({ mode: 'off' }, logger);
      expect((await egress.assertUrlAllowed('http://127.0.0.1/')).ok).toBe(true);
      expect((await egress.assertUrlAllowed('http://169.254.169.254/')).ok).toBe(true);
    });
  });

  describe('https_only', () => {
    test('blocks http when https_only', async () => {
      egress.initServer({ mode: 'protected', dns_check: false, https_only: true }, logger);
      const r = await egress.assertUrlAllowed('http://example.com/');
      expect(r.ok).toBe(false);
      expect(r.reason).toBe('HTTPS_ONLY');
    });
  });
});
