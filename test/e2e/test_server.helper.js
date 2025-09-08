const { fork } = require('child_process');
const path = require('path');
const axios = require('axios');

let serverProcess;

async function startServer() {
  const serverPath = path.resolve(__dirname, '..', '..', 'ginger.js');
  serverProcess = fork(serverPath, [], { silent: true }); // silent prevents logs from cluttering test output
  
  // Wait for the server to be ready by polling an endpoint
  await new Promise((resolve, reject) => {
    let attempts = 0;
    const interval = setInterval(async () => {
      try {
        await axios.get('http://localhost:7070/glade'); // Check if glade is running
        clearInterval(interval);
        resolve();
      } catch (e) {
        attempts++;
        if (attempts > 20) { // Timeout after ~2 seconds
          clearInterval(interval);
          reject(new Error("Server failed to start in time."));
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

module.exports = { startServer, stopServer };
