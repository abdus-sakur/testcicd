import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createApp, parsePort } from '../../src/app.mjs';

async function request(t, path, options) {
  const server = createApp();
  t.after(() => new Promise((resolve) => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return fetch(`http://127.0.0.1:${server.address().port}${path}`, options);
}

test('halaman utama menyajikan HTML dengan pembatasan konten', async (t) => {
  const response = await request(t, '/');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.match(response.headers.get('content-security-policy'), /default-src 'none'/);
  assert.match(await response.text(), /lang="id"/);
});

test('health check mengembalikan JSON yang dapat diperiksa proxy', async (t) => {
  const response = await request(t, '/health');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('route tidak dikenal mengembalikan 404', async (t) => {
  assert.equal((await request(t, '/missing')).status, 404);
});

test('mutasi ditolak dengan 405 dan header Allow', async (t) => {
  const response = await request(t, '/', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, HEAD');
});

test('HEAD tidak mengirim body', async (t) => {
  const response = await request(t, '/', { method: 'HEAD' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
});

test('port memerlukan integer valid dalam rentang TCP', () => {
  assert.equal(parsePort(undefined), 3000);
  assert.equal(parsePort('8080'), 8080);
  for (const value of ['', '0', '65536', '-1', '3.5', '3000abc']) {
    assert.throws(() => parsePort(value), /PORT/);
  }
});
