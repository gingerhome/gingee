const fs = require('fs');
const os = require('os');
const path = require('path');
const audit = require('../../modules/audit');

describe('audit.js', () => {
  let tmpRoot;
  let auditFile;

  beforeEach(() => {
    audit._resetForTests();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-audit-'));
    auditFile = path.join(tmpRoot, 'logs', 'audit.jsonl');
    audit.initServer(
      { enabled: true, path: './logs/audit.jsonl' },
      tmpRoot,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() }
    );
  });

  afterEach(() => {
    audit._resetForTests();
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  test('initServer creates logs directory and reports config', () => {
    expect(fs.existsSync(path.dirname(auditFile))).toBe(true);
    const cfg = audit.getConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.resolvedPath).toBe(auditFile);
  });

  test('emit appends one JSON line with ts, event, actor, app, details', () => {
    audit.emit(
      'permission.set',
      { previous: ['fs'], granted: ['fs', 'db'] },
      { app: 'myapp', actor: 'glade' }
    );
    const raw = fs.readFileSync(auditFile, 'utf8').trim();
    const lines = raw.split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]);
    expect(rec.event).toBe('permission.set');
    expect(rec.app).toBe('myapp');
    expect(rec.actor).toBe('glade');
    expect(rec.details.previous).toEqual(['fs']);
    expect(rec.details.granted).toEqual(['fs', 'db']);
    expect(rec.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test('emit is a no-op when disabled', () => {
    audit.initServer(
      { enabled: false, path: './logs/audit.jsonl' },
      tmpRoot,
      { info: jest.fn() }
    );
    audit.emit('app.delete', {}, { app: 'x' });
    expect(fs.existsSync(auditFile)).toBe(false);
  });

  test('multiple events append as separate lines', () => {
    audit.emit('app.install', { permissions: ['cache'] }, { app: 'a' });
    audit.emit('app.reload', {}, { app: 'a' });
    const lines = fs.readFileSync(auditFile, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('app.install');
    expect(JSON.parse(lines[1]).event).toBe('app.reload');
  });

  test('defaults actor to system when no ALS context', () => {
    audit.emit('app.delete', {}, { app: 'gone' });
    const rec = JSON.parse(fs.readFileSync(auditFile, 'utf8').trim());
    expect(rec.actor).toBe('system');
  });
});
