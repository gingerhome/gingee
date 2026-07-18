const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

let serverProcess;

/**
 * Use the same HTTP port as the forked gingee.js process: gingee.json → server.http.port,
 * else engine default 7070. Do not hardcode a port that may differ from the developer's config.
 */
function getHttpPort() {
  try {
    const cfgPath = path.resolve(__dirname, '..', '..', 'gingee.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    const port = cfg && cfg.server && cfg.server.http && cfg.server.http.port;
    if (port != null && Number.isFinite(Number(port)) && Number(port) > 0) {
      return Number(port);
    }
  } catch (_) {
    /* fall through to default */
  }
  return 7070;
}

const HTTP_PORT = getHttpPort();
const BASE_URL = `http://localhost:${HTTP_PORT}`;

async function isGingeeReady() {
  try {
    const response = await axios.get(`${BASE_URL}/glade/login.html`, {
      timeout: 800,
      validateStatus: () => true,
      maxRedirects: 5
    });
    return (
      response.status === 200 &&
      typeof response.data === 'string' &&
      response.data.includes('Glade')
    );
  } catch (_) {
    return false;
  }
}

async function startServer() {
  // Reuse an already-running Gingee on the configured port (e.g. dev server).
  if (await isGingeeReady()) {
    return;
  }

  const serverPath = path.resolve(__dirname, '..', '..', 'gingee.js');
  const stderrChunks = [];

  // No GINGEE_HTTP_PORT override — child loads gingee.json the same way as production/dev.
  serverProcess = fork(serverPath, [], {
    silent: true,
    env: { ...process.env }
  });

  if (serverProcess.stderr) {
    serverProcess.stderr.on('data', (d) => stderrChunks.push(d.toString()));
  }
  if (serverProcess.stdout) {
    serverProcess.stdout.on('data', () => {});
  }

  serverProcess.on('exit', (code, signal) => {
    if (code && code !== 0) {
      serverProcess._exitInfo = { code, signal, stderr: stderrChunks.join('') };
    }
  });

  await new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 60; // ~6s
    const interval = setInterval(async () => {
      try {
        if (await isGingeeReady()) {
          clearInterval(interval);
          resolve();
          return;
        }
        attempts++;
        if (serverProcess._exitInfo) {
          clearInterval(interval);
          reject(
            new Error(
              `Server exited before ready (code=${serverProcess._exitInfo.code}). ` +
                `stderr: ${serverProcess._exitInfo.stderr || '(none)'}`
            )
          );
          return;
        }
        if (attempts > maxAttempts) {
          clearInterval(interval);
          const errOut = stderrChunks.join('') || 'no Glade login response';
          reject(
            new Error(
              `Server failed to start in time on ${BASE_URL} ` +
                `(port from gingee.json or default 7070). Last error: ${errOut}`
            )
          );
        }
      } catch (e) {
        attempts++;
        if (attempts > maxAttempts) {
          clearInterval(interval);
          reject(e);
        }
      }
    }, 100);
  });
}

async function stopServer() {
  // Only kill the process we forked — not a pre-existing dev server on the same port.
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

module.exports = { startServer, stopServer, BASE_URL, HTTP_PORT, getHttpPort };
