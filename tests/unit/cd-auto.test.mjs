import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { checkPush } from '../../scripts/cd-auto.mjs';

const sha = 'a'.repeat(40);
const refs = { master: sha, success: sha };
const config = { origin: 'http://127.0.0.1:8000', uuid: 'app', configToken: 'local-secret', deployToken: 'local-secret' };

function harness(overrides = {}) {
  const calls = [];
  const saved = [];
  const deployments = [];
  return { calls, saved, deployments, dependencies: {
    fetch: async (url, options) => {
      calls.push({ url, options });
      let body;
      const page = new URL(url).searchParams.get('skip');
      const history = overrides.pages ? overrides.pages[Number(page) / 100] : overrides.history ?? [];
      body = { deployments: history, count: overrides.total ?? history.length };
      return new Response(JSON.stringify(body), { status: overrides.httpStatus ?? 200 });
    },
    readRefs: async () => overrides.refs ?? refs,
    save: async (value) => saved.push(value),
    deploy: async (value) => {
      deployments.push(value);
      if (overrides.failDeployment) throw new Error('Deployment gagal.');
      return 'deployment-uuid';
    },
  } };
}

test('deploy hanya setelah CI push master sukses dan head masih cocok', async () => {
  const h = harness();
  const result = await checkPush({ repository: 'owner/repo', config }, h.dependencies);
  assert.equal(result.status, 'deployment_finished');
  assert.equal(h.deployments[0].sha, sha);
  assert.deepEqual(h.saved.map((item) => item.status), ['deploying', 'finished']);
  assert.ok(h.calls.every((item) => item.url.startsWith(config.origin)));
});

for (const value of [{ master: sha }, { master: sha, success: 'b'.repeat(40) }, { master: 'invalid', success: 'invalid' }]) {
  test(`referensi CI tidak layak tidak menjalankan CD: ${JSON.stringify(value)}`, async () => {
    const h = harness({ refs: value });
    await checkPush({ repository: 'owner/repo', config }, h.dependencies);
    assert.equal(h.deployments.length, 0);
    assert.equal(h.calls.length, 0);
    assert.equal(h.saved.length, 0);
  });
}

test('deployment aktif dan commit sudah sehat tidak diduplikasi', async () => {
  for (const [status, expected] of [['in_progress', 'deployment_active'], ['queued', 'deployment_active'], ['finished', 'already_deployed']]) {
    const h = harness({ history: [{ status, commit: sha }] });
    assert.equal((await checkPush({ repository: 'owner/repo', config }, h.dependencies)).status, expected);
    assert.equal(h.deployments.length, 0);
  }
});

test('kegagalan dicatat dan tidak diulang tanpa push baru', async () => {
  const h = harness({ failDeployment: true });
  await assert.rejects(checkPush({ repository: 'owner/repo', config }, h.dependencies));
  const state = h.saved.at(-1);
  assert.equal(state.status, 'failed');
  assert.equal((await checkPush({ repository: 'owner/repo', config, state }, h.dependencies)).status, 'already_attempted');
  assert.equal(h.deployments.length, 1);
  const retry = harness({ refs: { master: 'b'.repeat(40), success: 'b'.repeat(40) } });
  assert.equal((await checkPush({ repository: 'owner/repo', config, state }, retry.dependencies)).status, 'deployment_finished');
  assert.ok(!JSON.stringify(state).includes('local-secret'));
});

test('API Coolify gagal menghentikan deployment tanpa menyimpan attempt', async () => {
  const h = harness({ httpStatus: 401 });
  await assert.rejects(checkPush({ repository: 'owner/repo', config }, h.dependencies), /HTTP 401/);
  assert.equal(h.saved.length, 0);
  assert.equal(h.deployments.length, 0);
});

test('master yang maju selama pemeriksaan Coolify menunda CD lama', async () => {
  const h = harness();
  let calls = 0;
  h.dependencies.readRefs = async () => ++calls === 1 ? refs : { master: 'b'.repeat(40), success: sha };
  assert.equal((await checkPush({ repository: 'owner/repo', config }, h.dependencies)).status, 'obsolete_push');
  assert.equal(h.deployments.length, 0);
  assert.equal(h.saved.length, 0);
});

test('status server tidak dikenal menghentikan CD', async () => {
  const h = harness({ history: [{ status: 'unknown' }] });
  await assert.rejects(checkPush({ repository: 'owner/repo', config }, h.dependencies), /tidak dikenali/);
  assert.equal(h.deployments.length, 0);
});

test('deployment aktif pada halaman riwayat berikutnya mencegah CD', async () => {
  const h = harness({ pages: [Array.from({ length: 100 }, () => ({ status: 'failed' })), [{ status: 'in_progress' }]], total: 101 });
  assert.equal((await checkPush({ repository: 'owner/repo', config }, h.dependencies)).status, 'deployment_active');
  assert.equal(h.deployments.length, 0);
  assert.equal(h.calls.length, 2);
});

test('entrypoint melalui symlink tetap menjalankan polling dan menolak konfigurasi kosong', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'testcicd-entry-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, 'cd-auto.mjs');
  await symlink(fileURLToPath(new URL('../../scripts/cd-auto.mjs', import.meta.url)), entry);
  await assert.rejects(promisify(execFile)(process.execPath, [entry], {
    env: { ...process.env, XDG_CONFIG_HOME: directory, XDG_STATE_HOME: join(directory, 'state') }, timeout: 5_000,
  }), (error) => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stderr).status, 'failed');
    return true;
  });
});
