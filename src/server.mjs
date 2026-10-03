import { createApp, parsePort } from './app.mjs';

const port = parsePort(process.env.PORT);
const server = createApp();
let stopping = false;

server.on('error', (error) => {
  console.error(JSON.stringify({ event: 'server_error', code: error.code ?? 'UNKNOWN' }));
  process.exitCode = 1;
});

server.listen(port, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'server_started', port }));
});

function shutdown() {
  if (stopping) return;
  stopping = true;
  console.log(JSON.stringify({ event: 'server_stopping' }));
  const timeout = setTimeout(() => {
    server.closeAllConnections();
    process.exitCode = 1;
  }, 10_000);
  timeout.unref();
  server.close(() => clearTimeout(timeout));
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
