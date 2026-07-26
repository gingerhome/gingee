const fs = require('fs');
const os = require('os');
const path = require('path');
const logViewer = require('../../modules/log_viewer');

describe('log_viewer', () => {
  let tmp;
  let projectRoot;
  let webPath;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-logs-'));
    projectRoot = tmp;
    webPath = path.join(tmp, 'web');
    fs.mkdirSync(path.join(projectRoot, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(webPath, 'glade', 'box', 'logs'), { recursive: true });
    fs.mkdirSync(path.join(webPath, 'myapp', 'box', 'logs'), { recursive: true });

    const serverLines = [
      JSON.stringify({
        level: 'info',
        message: 'engine boot',
        timestamp: '2026-07-26T10:00:00.000Z'
      }),
      JSON.stringify({
        app: 'glade',
        level: 'info',
        message: 'glade said hi',
        timestamp: '2026-07-26T10:00:01.000Z'
      }),
      JSON.stringify({
        app: 'myapp',
        level: 'error',
        message: 'boom',
        timestamp: '2026-07-26T10:00:02.000Z'
      }),
      'not-json plain line'
    ];
    fs.writeFileSync(
      path.join(projectRoot, 'logs', 'gingee-2026-07-26.log'),
      serverLines.join('\n') + '\n'
    );

    fs.writeFileSync(
      path.join(webPath, 'glade', 'box', 'logs', 'app-2026-07-26.log'),
      JSON.stringify({
        app: 'glade',
        level: 'warn',
        message: 'only in glade file',
        timestamp: '2026-07-26T11:00:00.000Z'
      }) + '\n'
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  test('listLogFiles server returns gingee logs', () => {
    const r = logViewer.listLogFiles({
      scope: 'server',
      projectRoot,
      webPath
    });
    expect(r.files.some((f) => f.name === 'gingee-2026-07-26.log')).toBe(true);
  });

  test('listLogFiles app includes glade', () => {
    const r = logViewer.listLogFiles({
      scope: 'app',
      appName: 'glade',
      projectRoot,
      webPath
    });
    expect(r.files.some((f) => f.name === 'app-2026-07-26.log')).toBe(true);
  });

  test('readLogFile tails and parses JSON; default 100', () => {
    const r = logViewer.readLogFile({
      scope: 'server',
      projectRoot,
      webPath,
      lines: 100
    });
    expect(r.file).toBe('gingee-2026-07-26.log');
    expect(r.lines.length).toBeGreaterThanOrEqual(3);
    expect(r.lines.some((l) => l.app === 'glade')).toBe(true);
    expect(r.lines.some((l) => !l.app && l.message && l.message.includes('engine'))).toBe(
      true
    );
  });

  test('engineOnly drops app-forwarded lines', () => {
    const r = logViewer.readLogFile({
      scope: 'server',
      projectRoot,
      webPath,
      engineOnly: true,
      lines: 100
    });
    expect(r.lines.every((l) => !l.app)).toBe(true);
    expect(r.lines.some((l) => l.message && l.message.includes('engine'))).toBe(true);
  });

  test('level filter error', () => {
    const r = logViewer.readLogFile({
      scope: 'server',
      projectRoot,
      webPath,
      level: 'error',
      lines: 100
    });
    expect(r.lines.length).toBeGreaterThanOrEqual(1);
    expect(r.lines.every((l) => (l.level || '').toLowerCase() === 'error')).toBe(true);
  });

  test('rejects path escape in appName', () => {
    expect(() =>
      logViewer.listLogFiles({
        scope: 'app',
        appName: '../etc',
        projectRoot,
        webPath
      })
    ).toThrow(/Invalid appName/);
  });

  test('rejects non-log file names', () => {
    expect(() =>
      logViewer.readLogFile({
        scope: 'server',
        projectRoot,
        webPath,
        file: '../secrets.txt'
      })
    ).toThrow();
  });

  test('hideLogQueries filters logs-list/logs-read noise by default', () => {
    fs.appendFileSync(
      path.join(projectRoot, 'logs', 'gingee-2026-07-26.log'),
      [
        JSON.stringify({
          level: 'info',
          message: 'Executing script: E:\\\\repos\\\\gingee\\\\web\\\\glade\\\\box\\\\api\\\\logs-read.js',
          timestamp: '2026-07-26T12:00:00.000Z'
        }),
        JSON.stringify({
          app: 'glade',
          level: 'info',
          message: 'Response sent by: logs-list.js',
          timestamp: '2026-07-26T12:00:01.000Z'
        }),
        JSON.stringify({
          level: 'info',
          message: 'real work happened',
          timestamp: '2026-07-26T12:00:02.000Z'
        })
      ].join('\n') + '\n'
    );

    const hidden = logViewer.readLogFile({
      scope: 'server',
      projectRoot,
      webPath,
      lines: 100
      // hideLogQueries defaults true
    });
    expect(hidden.lines.some((l) => /logs-read\.js|logs-list\.js/.test(l.message || ''))).toBe(
      false
    );
    expect(hidden.lines.some((l) => l.message === 'real work happened')).toBe(true);

    const shown = logViewer.readLogFile({
      scope: 'server',
      projectRoot,
      webPath,
      lines: 100,
      hideLogQueries: false
    });
    expect(shown.lines.some((l) => /logs-read\.js|logs-list\.js/.test(l.message || ''))).toBe(
      true
    );
  });
});
