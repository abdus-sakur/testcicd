import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deploy, readConfig } from '../../scripts/deploy.mjs';

const environment = {
  COOLIFY_URL: 'https://coolify.example.com',
  COOLIFY_APP_UUID: 'sample-app-123',
  COOLIFY_CONFIG_TOKEN: 'test-config-token',
  COOLIFY_DEPLOY_TOKEN: 'test-deploy-token',
  GITHUB_SHA: 'a'.repeat(40),
};

test('konfigurasi menolak HTTP, credential URL, path, UUID dan SHA tidak valid', () => {
  for (const override of [
    { COOLIFY_URL: 'http://coolify.example.com' },
    { COOLIFY_URL: 'https://user:pass@coolify.example.com' },
    { COOLIFY_URL: 'https://coolify.example.com/api' },
    { COOLIFY_APP_UUID: '../other' },
    { GITHUB_SHA: 'master' },
    { COOLIFY_DEPLOY_TOKEN: '' },
  ]) {
    assert.throws(() => readConfig({ ...environment, ...override }));
  }
});

test('HTTP hanya diizinkan untuk loopback lokal', () => {
  assert.equal(readConfig({ ...environment, COOLIFY_URL: 'http://127.0.0.1:8000' }).origin, 'http://127.0.0.1:8000');
  assert.equal(readConfig({ ...environment, COOLIFY_URL: 'http://localhost:8000' }).origin, 'http://localhost:8000');
  assert.throws(() => readConfig({ ...environment, COOLIFY_URL: 'http://192.168.1.1:8000' }));
  assert.throws(() => readConfig({ ...environment, COOLIFY_URL: 'http://127.0.0.1.example.com:8000' }));
});

test('deployment mengunci SHA dan menunggu selesai dengan token sesuai izin', async () => {
  const requests = [];
  const replies = [{}, { deployments: [{ resource_uuid: 'sample-app-123', deployment_uuid: 'deploy-123' }] }, { status: 'in_progress' }, { status: 'finished', commit: 'a'.repeat(40) }];
  const result = await deploy(readConfig(environment), {
    fetch: async (url, options) => {
      requests.push({ url: String(url), ...options });
      return Response.json(replies.shift());
    },
    sleep: async () => {},
  });
  assert.equal(result, 'deploy-123');
  assert.equal(requests[0].method, 'PATCH');
  assert.deepEqual(JSON.parse(requests[0].body), { git_commit_sha: 'a'.repeat(40), is_auto_deploy_enabled: false });
  assert.equal(requests[0].headers.Authorization, 'Bearer test-config-token');
  assert.equal(requests[1].headers.Authorization, 'Bearer test-deploy-token');
  assert.deepEqual(JSON.parse(requests[1].body), { uuid: 'sample-app-123', force: false });
  assert.equal(requests[2].url, 'https://coolify.example.com/api/v1/deployments/deploy-123');
  assert.equal(requests.length, 4);
});

test('API error menghentikan proses tanpa membocorkan response sensitif', async () => {
  let calls = 0;
  await assert.rejects(deploy(readConfig(environment), {
    fetch: async () => {
      calls++;
      return new Response('secret-response', { status: 403 });
    },
  }), { message: 'Coolify API mengembalikan HTTP 403.' });
  assert.equal(calls, 1);
});

test('deployment commit lain tidak dianggap sukses', async () => {
  const replies = [{}, { deployments: [{ resource_uuid: 'sample-app-123', deployment_uuid: 'deploy-123' }] }, { status: 'finished', commit: 'b'.repeat(40) }];
  await assert.rejects(deploy(readConfig(environment), {
    fetch: async () => Response.json(replies.shift()),
  }), /Commit deployment berbeda/);
});

test('respons non-JSON tidak membocorkan isinya pada error', async () => {
  await assert.rejects(deploy(readConfig(environment), {
    fetch: async () => new Response('sensitive-data'),
  }), { message: 'Respons Coolify bukan JSON valid.' });
});

test('deployment yang terus antre memiliki batas waktu', async () => {
  let calls = 0;
  await assert.rejects(deploy(readConfig(environment), {
    fetch: async () => {
      calls++;
      if (calls === 1) return Response.json({});
      if (calls === 2) return Response.json({ deployments: [{ resource_uuid: 'sample-app-123', deployment_uuid: 'deploy-123' }] });
      return Response.json({ status: 'queued' });
    },
    sleep: async () => {},
  }), /Batas waktu/);
  assert.equal(calls, 92);
});

test('deployment gagal menyebabkan CI gagal', async () => {
  const replies = [{}, { deployments: [{ resource_uuid: 'sample-app-123', deployment_uuid: 'deploy-123' }] }, { status: 'failed' }];
  await assert.rejects(deploy(readConfig(environment), {
    fetch: async () => Response.json(replies.shift()),
    sleep: async () => {},
  }), /failed/);
});

test('respons tanpa deployment UUID tidak dianggap sukses', async () => {
  const replies = [{}, { deployments: [] }];
  await assert.rejects(deploy(readConfig(environment), {
    fetch: async () => Response.json(replies.shift()),
  }), /UUID/);
});
