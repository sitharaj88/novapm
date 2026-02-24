import http from 'node:http';
import { hostname } from 'node:os';

const PORT = parseInt(process.env.PORT, 10) || 3000;

// -------------------------------------------------------------------------
// Simple HTTP server suitable for running under NovaPM inside a container.
// -------------------------------------------------------------------------
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      pid: process.pid,
      hostname: hostname(),
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage().rss,
      timestamp: new Date().toISOString(),
    }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'Hello from NovaPM in Docker!',
    pid: process.pid,
    hostname: hostname(),
    env: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
  }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({
    event: 'server:start',
    pid: process.pid,
    hostname: hostname(),
    port: PORT,
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  }));
});

// -------------------------------------------------------------------------
// Graceful shutdown
// -------------------------------------------------------------------------
// NovaPM sends SIGINT first and then SIGTERM after kill_timeout. We handle
// both so in-flight requests can drain before the process exits.

function shutdown(signal) {
  console.log(JSON.stringify({
    event: 'server:shutdown',
    signal,
    pid: process.pid,
    timestamp: new Date().toISOString(),
  }));

  server.close(() => {
    console.log(JSON.stringify({
      event: 'server:closed',
      pid: process.pid,
      timestamp: new Date().toISOString(),
    }));
    process.exit(0);
  });

  // Force exit if the server hasn't closed within 5 seconds
  setTimeout(() => {
    console.error(JSON.stringify({
      event: 'server:force-exit',
      pid: process.pid,
      timestamp: new Date().toISOString(),
    }));
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
