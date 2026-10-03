import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { withDeploymentLock } from '../../scripts/local-runtime.mjs';

test('lock bersama mencegah deployment paralel dan terlepas setelah error', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'testcicd-lock-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'deploy.flock');
  await assert.rejects(withDeploymentLock(async () => {
    assert.deepEqual(await withDeploymentLock(() => assert.fail('Tidak boleh berjalan paralel.'), path), { status: 'locked' });
    throw new Error('Simulasi kegagalan.');
  }, path), /Simulasi/);
  assert.equal(await withDeploymentLock(async () => 'released', path), 'released');
});

test('lock terlepas otomatis ketika proses mati', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'testcicd-crash-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'deploy.flock');
  const moduleUrl = new URL('../../scripts/local-runtime.mjs', import.meta.url).href;
  const script = `import { withDeploymentLock } from ${JSON.stringify(moduleUrl)}; await withDeploymentLock(async () => { await new Promise(() => { setInterval(() => global.gc(), 10); setTimeout(() => { global.gc(); process.stdout.write('ready'); }, 50); }); }, ${JSON.stringify(path)});`;
  const child = spawn(process.execPath, ['--expose-gc', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill('SIGKILL'));
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('ready')) resolve();
    });
    child.once('error', reject);
    child.once('exit', () => reject(new Error('LOCK_CHILD_EXITED_EARLY')));
  });
  assert.deepEqual(await withDeploymentLock(async () => 'unexpected', path), { status: 'locked' }, 'LOCK_LOST_BEFORE_CRASH');
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
  assert.equal(await withDeploymentLock(async () => 'released', path), 'released', 'LOCK_RETAINED_AFTER_CRASH');
});
