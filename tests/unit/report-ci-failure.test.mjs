import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

test('diagnosis CI hanya menerbitkan nama dan kategori yang diizinkan', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'testcicd-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const log = join(directory, 'unit.log');
  await writeFile(log, 'not ok 31 - lock terlepas otomatis ketika proses mati\ncode: ERR_ASSERTION\nSECRET_SENTINEL=private-payload\nnot ok 32 - unknown-sensitive-test\n', { mode: 0o600 });
  const reporter = fileURLToPath(new URL('../../scripts/report-ci-failure.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [reporter, log]);
  const result = JSON.parse(stdout.slice(stdout.indexOf('::', 2) + 2));
  assert.deepEqual(result, { failed_tests: ['lock terlepas otomatis ketika proses mati'], error_categories: ['ERR_ASSERTION'] });
  assert.ok(!stdout.includes('private-payload'));
  assert.ok(!stdout.includes('unknown-sensitive-test'));
});
