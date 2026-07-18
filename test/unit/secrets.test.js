const fs = require('fs');
const os = require('os');
const path = require('path');
const secrets = require('../../modules/secrets');

describe('secrets.js', () => {
  let tmpRoot;
  let secretsDir;

  beforeEach(() => {
    secrets._resetForTests();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-secrets-'));
    secretsDir = path.join(tmpRoot, 'settings', 'secrets');
    fs.mkdirSync(secretsDir, { recursive: true });
    secrets.initServer(
      {
        load_dotenv: false,
        required: true,
        file_roots: [path.join(tmpRoot, 'settings', 'secrets')]
      },
      tmpRoot,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    );
  });

  afterEach(() => {
    secrets._resetForTests();
    delete process.env.GINGEE_TEST_SECRET_A;
    delete process.env.GINGEE_TEST_SECRET_B;
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  test('resolveValue env: reads process.env', () => {
    process.env.GINGEE_TEST_SECRET_A = 'from-env';
    expect(secrets.resolveValue('env:GINGEE_TEST_SECRET_A')).toBe('from-env');
  });

  test('resolveValue env: throws when missing and required', () => {
    expect(() => secrets.resolveValue('env:GINGEE_TEST_MISSING')).toThrow(/not set/);
  });

  test('resolveValue file: reads allowed secret file', () => {
    const f = path.join(secretsDir, 'db_password');
    fs.writeFileSync(f, 's3cret\n', 'utf8');
    expect(secrets.resolveValue(`file:${f}`)).toBe('s3cret');
  });

  test('resolveValue file: rejects path outside file_roots', () => {
    const outside = path.join(tmpRoot, 'evil.txt');
    fs.writeFileSync(outside, 'nope', 'utf8');
    expect(() => secrets.resolveValue(`file:${outside}`)).toThrow(/file_roots/);
  });

  test('resolveDeep walks nested config and $secret objects', () => {
    process.env.GINGEE_TEST_SECRET_B = 'nested-key';
    const f = path.join(secretsDir, 'jwt');
    fs.writeFileSync(f, 'jwt-from-file', 'utf8');

    const cfg = {
      name: 'demo',
      jwt_secret: `file:${f}`,
      ai: {
        type: 'gemini',
        api_key: 'env:GINGEE_TEST_SECRET_B'
      },
      db: [
        {
          name: 'main',
          password: { $secret: 'env:GINGEE_TEST_SECRET_B' }
        }
      ],
      plain: 'hello'
    };

    const resolved = secrets.resolveDeep(cfg);
    expect(resolved.jwt_secret).toBe('jwt-from-file');
    expect(resolved.ai.api_key).toBe('nested-key');
    expect(resolved.db[0].password).toBe('nested-key');
    expect(resolved.plain).toBe('hello');
    // input not mutated
    expect(cfg.jwt_secret).toMatch(/^file:/);
  });

  test('optional secret returns null when required:false', () => {
    secrets.initServer(
      { required: true, file_roots: [secretsDir] },
      tmpRoot,
      { info: jest.fn(), warn: jest.fn() }
    );
    const v = secrets.resolveValue({ $secret: 'env:GINGEE_OPTIONAL_MISSING', required: false });
    expect(v).toBeNull();
  });

  test('load_dotenv injects missing keys only', () => {
    process.env.GINGEE_TEST_SECRET_A = 'already-set';
    fs.writeFileSync(
      path.join(tmpRoot, '.env'),
      'GINGEE_TEST_SECRET_A=from-dotenv\nGINGEE_TEST_SECRET_B=from-dotenv-b\n',
      'utf8'
    );
    secrets.initServer(
      { load_dotenv: true, file_roots: [secretsDir] },
      tmpRoot,
      { info: jest.fn(), warn: jest.fn() }
    );
    expect(process.env.GINGEE_TEST_SECRET_A).toBe('already-set');
    expect(process.env.GINGEE_TEST_SECRET_B).toBe('from-dotenv-b');
  });

  test('isSecretRef detects refs', () => {
    expect(secrets.isSecretRef('env:X')).toBe(true);
    expect(secrets.isSecretRef('file:/x')).toBe(true);
    expect(secrets.isSecretRef({ $secret: 'env:X' })).toBe(true);
    expect(secrets.isSecretRef('plain')).toBe(false);
  });
});
