// Simple test app for NovaPM
const http = require('http');

const PORT = process.env.PORT || 3456;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'Hello from NovaPM test app!',
    pid: process.pid,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  }));
});

server.listen(PORT, () => {
  console.log(`Test app running on port ${PORT} (PID: ${process.pid})`);
});

// Log something every 5 seconds
setInterval(() => {
  console.log(`[${new Date().toISOString()}] Heartbeat - PID: ${process.pid}`);
}, 5000);
