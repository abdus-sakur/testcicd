import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deploy } from './deploy.mjs';
import { loadLocalConfig, withDeploymentLock } from './local-runtime.mjs';
export { parseToken } from './local-runtime.mjs';

export async function waitForCi(repository, sha, dependencies = {}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error('Repository atau SHA CI tidak valid.');
  }
  const fetchApi = dependencies.fetch ?? fetch;
  const wait = dependencies.sleep ?? sleep;
  const log = dependencies.log ?? console.log;
  const query = new URLSearchParams({ branch: 'master', event: 'push', head_sha: sha, per_page: '1' });
  for (let attempt = 0; attempt < 30; attempt++) {
    const response = await fetchApi(`https://api.github.com/repos/${repository}/actions/workflows/ci-cd.yml/runs?${query}`, {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status !== 404 && !response.ok) throw new Error(`GitHub API mengembalikan HTTP ${response.status}.`);
    const data = response.status === 404 ? { workflow_runs: [] } : await response.json();
    const run = data.workflow_runs?.find((item) => item.head_sha === sha && item.head_branch === 'master' && item.event === 'push');
    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') throw new Error(`CI berstatus ${run.conclusion}. Deployment dibatalkan.`);
      return run.html_url;
    }
    log(JSON.stringify({ event: 'waiting_for_ci', status: run?.status ?? 'pending', commit: sha }));
    await wait(60_000);
  }
  throw new Error('Batas waktu menunggu CI tercapai.');
}

async function runLocal() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  if (git('status', '--porcelain')) throw new Error('Working tree harus bersih sebelum deployment.');
  if (git('branch', '--show-current') !== 'master') throw new Error('Deployment lokal hanya untuk branch master.');
  const sha = git('rev-parse', 'HEAD');
  const { repository, config } = await loadLocalConfig(sha);
  const result = await withDeploymentLock(async () => {
    const ciUrl = await waitForCi(repository, sha);
    console.log(JSON.stringify({ event: 'ci_passed', url: ciUrl, commit: sha }));
    const uuid = await deploy(config);
    console.log(JSON.stringify({ event: 'deployment_finished', deployment_uuid: uuid, commit: sha }));
  });
  if (result?.status === 'locked') throw new Error('Deployment lain sedang berjalan.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await runLocal();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
