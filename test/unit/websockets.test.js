/**
 * WebSocket hub + public module tests.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const hub = require('../../modules/engine/websocket_hub');
const { als } = require('../../modules/gingee');
const websockets = require('../../modules/websockets');

describe('websocket hub helpers', () => {
  test('normalizePath and fullPathFor', () => {
    expect(hub.normalizePath('ws')).toBe('/ws');
    expect(hub.normalizePath('/ws/')).toBe('/ws');
    expect(hub.fullPathFor('demo', '/realtime')).toBe('/demo/realtime');
  });

  test('parseUpgradeUrl', () => {
    const p = hub.parseUpgradeUrl('/demo/ws?x=1');
    expect(p.appName).toBe('demo');
    expect(p.restPath).toBe('/ws');
    expect(p.searchParams.get('x')).toBe('1');
    expect(hub.parseUpgradeUrl('/onlyapp')).toBeNull();
  });

  test('tenantRoom and assertRoomTenant', () => {
    expect(hub.tenantRoom('acme', 'lobby')).toBe('t:acme:lobby');
    expect(hub.assertRoomTenant('t:acme:lobby', 'acme')).toBe(true);
    expect(() => hub.assertRoomTenant('t:other:lobby', 'acme')).toThrow(/tenant/);
  });
});

describe('websocket hub live upgrade', () => {
  let tmp;
  let server;
  let port;
  let app;

  beforeEach(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gingee-ws-'));
    const appWeb = path.join(tmp, 'web', 'chat');
    const box = path.join(appWeb, 'box');
    fs.mkdirSync(box, { recursive: true });
    fs.writeFileSync(
      path.join(box, 'app.json'),
      JSON.stringify({
        name: 'chat',
        websockets: {
          enabled: true,
          path: '/ws',
          handler: 'ws_handler.js'
        }
      })
    );
    fs.writeFileSync(
      path.join(box, 'ws_handler.js'),
      `
module.exports = async function (socket, ctx) {
  socket.join('lobby');
  socket.send({ type: 'welcome', app: ctx.app.name });
  socket.on('message', (raw) => {
    let msg = raw;
    try { msg = JSON.parse(raw); } catch (_) {}
    socket.to('lobby').send({ type: 'echo', from: socket.id, msg });
    if (msg && msg.broadcast) {
      try {
        const ws = require('websockets');
        const n = ws.toRoom('lobby', { type: 'system', text: 'ping' });
        socket.send({ type: 'broadcast_result', n: n });
      } catch (e) {
        socket.send({ type: 'broadcast_error', error: e.message });
      }
    }
  });
};
`
    );

    app = {
      name: 'chat',
      config: {
        name: 'chat',
        websockets: { enabled: true, path: '/ws', handler: 'ws_handler.js' }
      },
      appWebPath: appWeb,
      appBoxPath: box,
      grantedPermissions: ['websockets'],
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      in_maintenance: false
    };

    hub.shutdownAll();
    hub.initServer(
      {
        enabled: true,
        max_connections: 100,
        max_connections_per_app: 50,
        max_message_bytes: 65536,
        idle_timeout_ms: 60000,
        heartbeat_ms: 10000
      },
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      { box: { allowed_modules: [], allow_code_generation: true }, privileged_apps: [] }
    );
    hub.setAppsRegistry({ chat: app });
    const ok = await hub.registerApp(app, {
      box: { allowed_modules: [], allow_code_generation: true },
      privileged_apps: []
    });
    expect(ok).toBe(true);

    server = http.createServer((req, res) => {
      res.writeHead(200);
      res.end('ok');
    });
    hub.attachServer(server);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', resolve);
    });
    port = server.address().port;
  });

  afterEach(async () => {
    hub.shutdownAll();
    await new Promise((resolve) => server.close(resolve));
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  function connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/ws`);
      const messages = [];
      ws.on('message', (data) => {
        try {
          messages.push(JSON.parse(String(data)));
        } catch (_) {
          messages.push(String(data));
        }
      });
      ws.on('open', () => resolve({ ws, messages }));
      ws.on('error', reject);
    });
  }

  test('connects and receives welcome', async () => {
    const { ws, messages } = await connect();
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.some((m) => m.type === 'welcome' && m.app === 'chat')).toBe(true);
    expect(hub.getConnectionCount('chat')).toBe(1);
    ws.close();
    await new Promise((r) => setTimeout(r, 30));
  }, 10000);

  test('room echo between two clients', async () => {
    const a = await connect();
    const b = await connect();
    await new Promise((r) => setTimeout(r, 40));
    a.messages.length = 0;
    b.messages.length = 0;
    a.ws.send(JSON.stringify({ text: 'hi' }));
    await new Promise((r) => setTimeout(r, 80));
    expect(b.messages.some((m) => m.type === 'echo' && m.msg && m.msg.text === 'hi')).toBe(
      true
    );
    // sender excluded from to(room)
    expect(a.messages.some((m) => m.type === 'echo')).toBe(false);
    a.ws.close();
    b.ws.close();
  }, 10000);

  test('toRoom from require(websockets) in handler context', async () => {
    const a = await connect();
    const b = await connect();
    await new Promise((r) => setTimeout(r, 40));
    a.messages.length = 0;
    b.messages.length = 0;
    a.ws.send(JSON.stringify({ broadcast: true }));
    await new Promise((r) => setTimeout(r, 100));
    const err = a.messages.find((m) => m.type === 'broadcast_error');
    expect(err).toBeUndefined();
    // toRoom includes all members including sender
    expect(a.messages.some((m) => m.type === 'system')).toBe(true);
    expect(b.messages.some((m) => m.type === 'system')).toBe(true);
    a.ws.close();
    b.ws.close();
  }, 10000);

  test('public module toRoom from HTTP-like ALS context', async () => {
    const { ws, messages } = await connect();
    await new Promise((r) => setTimeout(r, 40));
    messages.length = 0;
    await als.run({ appName: 'chat', app }, async () => {
      websockets.toRoom('lobby', { type: 'from-http', ok: true });
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.some((m) => m.type === 'from-http')).toBe(true);
    ws.close();
  }, 10000);

  test('rejects unknown path', async () => {
    await expect(
      new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}/chat/nope`);
        ws.on('open', () => {
          ws.close();
          reject(new Error('should not open'));
        });
        ws.on('unexpected-response', (_req, res) => {
          expect(res.statusCode).toBe(404);
          resolve();
        });
        ws.on('error', () => {
          /* may also error */
          resolve();
        });
      })
    ).resolves.toBeUndefined();
  }, 10000);
});
