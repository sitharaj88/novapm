import http from 'node:http';

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    message: 'Hello from NovaPM!',
    pid: process.pid,
    env: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
  }));
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT} (PID: ${process.pid})`);
});
