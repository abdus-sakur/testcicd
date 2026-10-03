import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseToken, waitForCi } from '../../scripts/deploy-local.mjs';

test('token lokal menerima format plain dan assignment tanpa mengeksekusi isi file', () => {
  assert.equal(parseToken('123|sample-token\n'), '123|sample-token');
  assert.equal(parseToken('COOLIFY_TOKEN="123|sample-token"'), '123|sample-token');
  assert.throws(() => parseToken('COOLIFY_TOKEN=$(whoami)'));
});

test('CD lokal menunggu CI sukses untuk SHA yang sama', async () => {
  const sha = 'a'.repeat(40);
  const replies = [
    { workflow_runs: [] },
    { workflow_runs: [{ head_sha: sha, head_branch: 'master', event: 'push', status: 'in_progress', conclusion: null }] },
    { workflow_runs: [{ head_sha: sha, head_branch: 'master', event: 'push', status: 'completed', conclusion: 'success', html_url: 'https://github.com/sample/repo/actions/runs/1' }] },
  ];
  const result = await waitForCi('sample/repo', sha, {
    fetch: async () => Response.json(replies.shift()),
    sleep: async () => {},
    log: () => {},
  });
  assert.equal(result, 'https://github.com/sample/repo/actions/runs/1');
});

test('CI gagal melarang CD', async () => {
  await assert.rejects(waitForCi('sample/repo', 'a'.repeat(40), {
    fetch: async () => Response.json({ workflow_runs: [{ head_sha: 'a'.repeat(40), head_branch: 'master', event: 'push', status: 'completed', conclusion: 'failure' }] }),
    log: () => {},
  }), /CI berstatus failure/);
});

test('hasil CI commit lain tidak memberi izin deployment', async () => {
  await assert.rejects(waitForCi('sample/repo', 'a'.repeat(40), {
    fetch: async () => Response.json({ workflow_runs: [{ head_sha: 'b'.repeat(40), head_branch: 'master', event: 'push', status: 'completed', conclusion: 'success' }] }),
    sleep: async () => {},
    log: () => {},
  }), /Batas waktu/);
});
