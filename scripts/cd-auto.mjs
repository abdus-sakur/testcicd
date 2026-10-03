import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { promisify } from 'node:util';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deploy } from './deploy.mjs';
import { loadLocalConfig, stateDirectory, withDeploymentLock } from './local-runtime.mjs';

async function request(url, headers, fetchApi) {
  const response = await fetchApi(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`API mengembalikan HTTP ${response.status}.`);
  return response.json();
}

export async function readRemoteRefs(repository) {
  const { stdout } = await promisify(execFile)('/usr/bin/git', ['ls-remote', `https://github.com/${repository}.git`, 'refs/heads/master', 'refs/heads/ci-success'], {
    timeout: 30_000, maxBuffer: 16_384,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  const refs = {};
  for (const line of stdout.trim().split('\n')) {
    const match = line.match(/^([a-f0-9]{40})\s+refs\/heads\/(master|ci-success)$/);
    if (match) refs[match[2] === 'master' ? 'master' : 'success'] = match[1];
  }
  return refs;
}

export async function checkPush({ repository, config, state = {} }, dependencies = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Repository tidak valid.');
  const fetchApi = dependencies.fetch ?? fetch;
  const save = dependencies.save ?? (async () => {});
  const deployApplication = dependencies.deploy ?? deploy;
  const readRefs = dependencies.readRefs ?? readRemoteRefs;
  const refs = await readRefs(repository);
  const sha = refs.master;
  if (!/^[a-f0-9]{40}$/.test(sha ?? '') || refs.success !== sha) return { status: 'ci_not_successful' };
  const key = sha;
  if (state.attempt === key) return { status: 'already_attempted', commit: sha };
  let latest;
  let complete = false;
  for (let page = 0; page < 100; page++) {
    const history = await request(`${config.origin}/api/v1/deployments/applications/${config.uuid}?take=100&skip=${page * 100}`,
      { Authorization: `Bearer ${config.configToken}`, Accept: 'application/json' }, fetchApi);
    if (!Array.isArray(history.deployments) || !Number.isSafeInteger(history.count) || history.count < 0) throw new Error('Riwayat deployment tidak valid.');
    if (page === 0) latest = history.deployments[0];
    for (const item of history.deployments) {
      if (!['queued', 'in_progress', 'finished', 'failed', 'cancelled', 'cancelled-by-user'].includes(item.status)) throw new Error('Status deployment tidak dikenali.');
      if (['queued', 'in_progress'].includes(item.status)) return { status: 'deployment_active' };
    }
    if (page * 100 + history.deployments.length >= history.count) {
      complete = true;
      break;
    }
    if (history.deployments.length !== 100) throw new Error('Pagination deployment tidak lengkap.');
  }
  if (!complete) throw new Error('Riwayat deployment melebihi batas pemeriksaan.');
  if (latest?.status === 'finished' && latest.commit === sha) {
    await save({ attempt: key, status: 'finished', commit: sha, deployment_uuid: latest.deployment_uuid });
    return { status: 'already_deployed', commit: sha };
  }
  const current = await readRefs(repository);
  if (current.master !== sha || current.success !== sha) return { status: 'obsolete_push', commit: sha };
  const record = { attempt: key, status: 'deploying', commit: sha, updated_at: new Date().toISOString() };
  await save(record);
  try {
    const uuid = await deployApplication({ ...config, sha });
    await save({ ...record, status: 'finished', deployment_uuid: uuid });
    return { status: 'deployment_finished', commit: sha, deployment_uuid: uuid };
  } catch (error) {
    await save({ ...record, status: 'failed' });
    throw error;
  }
}

async function run() {
  const result = await withDeploymentLock(async () => {
    const local = await loadLocalConfig();
    const statePath = join(stateDirectory, 'auto-cd.json');
    let state = {};
    try {
      state = JSON.parse(await readFile(statePath, 'utf8'));
      if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('State CD tidak valid.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    return checkPush({ ...local, state }, { save: async (value) => {
      const temporary = `${statePath}.${process.pid}.tmp`;
      await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600, flag: 'wx' });
      await rename(temporary, statePath);
    } });
  });
  console.log(JSON.stringify({ event: 'auto_cd', ...result }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  try {
    await run();
  } catch {
    console.error(JSON.stringify({ event: 'auto_cd', status: 'failed' }));
    process.exitCode = 1;
  }
}
