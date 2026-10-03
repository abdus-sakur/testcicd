import { createServer } from 'node:http';

const page = `<!doctype html>
<html lang="id">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sampel CI/CD Coolify</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <main>
    <p class="badge">Sampel Deployment</p>
    <h1>CI/CD Dengan Coolify</h1>
    <p>Aplikasi ini menjalankan tes otomatis sebelum deployment.</p>
    <ol>
      <li>Push kode ke GitHub.</li>
      <li>GitHub Actions menjalankan unit test dan build Docker.</li>
      <li>Coolify men-deploy commit yang lolos CI.</li>
    </ol>
    <a href="/health">Periksa Kesehatan Aplikasi</a>
  </main>
</body>
</html>`;

const stylesheet = `:root{color-scheme:light dark;font-family:system-ui,sans-serif;line-height:1.6}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101827;color:#e5edf8}main{max-width:44rem;margin:2rem;padding:2rem;border:1px solid #334155;border-radius:1rem;background:#172234}h1{font-size:clamp(1.8rem,5vw,3rem);line-height:1.2}.badge{color:#7dd3fc}li{margin-block:.7rem}a{color:#7dd3fc}a:focus-visible{outline:3px solid #7dd3fc;outline-offset:5px}`;

export function parsePort(value) {
  if (value === undefined) return 3000;
  if (!/^\d+$/.test(value)) throw new Error('PORT harus integer 1–65535.');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT harus integer 1–65535.');
  }
  return port;
}

export function createApp() {
  const server = createServer({
    requestTimeout: 15_000,
    headersTimeout: 10_000,
    keepAliveTimeout: 5_000,
    maxHeaderSize: 8192,
  }, (request, response) => {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    };
    let status = 200;
    let body;
    const path = (request.url ?? '').split('?')[0];
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      status = 405;
      headers.Allow = 'GET, HEAD';
      headers.Connection = 'close';
      body = JSON.stringify({ error: 'Metode tidak diizinkan.' });
    } else if (path === '/') {
      headers['Content-Type'] = 'text/html; charset=utf-8';
      body = page;
    } else if (path === '/style.css') {
      headers['Content-Type'] = 'text/css; charset=utf-8';
      body = stylesheet;
    } else if (path === '/health') {
      body = JSON.stringify({ status: 'ok' });
    } else {
      status = 404;
      body = JSON.stringify({ error: 'Halaman tidak ditemukan.' });
    }
    headers['Content-Length'] = Buffer.byteLength(body);
    response.writeHead(status, headers);
    response.end(request.method === 'HEAD' ? undefined : body);
  });
  server.maxHeadersCount = 50;
  server.maxRequestsPerSocket = 100;
  return server;
}
