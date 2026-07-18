const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

let serverProcess;

function getHttpPort() {
  try {
    const cfgPath = path.resolve(__dirname, '..', '..', 'gingee.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg.server && cfg.server.http && cfg.server.http.port) {
      return Number(cfg.server.http.port);
    }
  } catch (_) {
    /* use default */
  }
  return 7070;
}

const HTTP_PORT = getHttpPort();
const BASE_URL = `http://localhost:${HTTP_PORT}`;

async function startServer() {
  const serverPath = path.resolve(__dirname, '..', '..', 'gingee.js');
  const stderrChunks = [];
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
      // keep for timeout message
      serverProcess._exitInfo = { code, signal, stderr: stderrChunks.join('') };
    }
  });

  // Wait for the server to be ready by polling an endpoint
  await new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 50; // ~5s
    const interval = setInterval(async () => {
      try {
        await axios.get(`${BASE_URL}/glade`, { timeout: 500, validateStatus: () => true });
        clearInterval(interval);
        resolve();
      } catch (e) {
        attempts++;
        if (serverProcess._exitInfo) {
          clearInterval(interval);
          reject(
            new Error(
              `Server exited before ready (code=${serverProcess._exitInfo.code}). ` +
                `stderr: ${serverProcess._exitInfo.stderr || e.message}`
            )
          );
          return;
        }
        if (attempts > maxAttempts) {
          clearInterval(interval);
          const errOut = stderrChunks.join('') || e.message;
          reject(
            new Error(
              `Server failed to start in time on ${BASE_URL}. Last error: ${errOut}`
            )
          );
        }
      }
    }, 100);
  });
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

module.exports = { startServer, stopServer, BASE_URL, HTTP_PORT };
