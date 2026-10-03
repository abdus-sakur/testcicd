import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { mkdir, open, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readConfig } from './deploy.mjs';

export const stateDirectory = join(process.env.XDG_STATE_HOME ?? join(homedir(), '.local/state'), 'testcicd');

export function parseToken(raw) {
  const text = raw.trim();
  const assignment = text.match(/^(?:export\s+)?(?:COOLIFY_TOKEN|COOLIFY_API_TOKEN|TOKEN|token|api_token)\s*=\s*(.+)$/m);
  const token = (assignment ? assignment[1].trim() : text).replace(/^["']|["']$/g, '');
  if (!/^[A-Za-z0-9_|.\-]+$/.test(token)) throw new Error('Format file token Coolify tidak valid.');
  return token;
}

export async function loadLocalConfig(sha = '0'.repeat(40)) {
  const metadata = JSON.parse(await readFile(join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'testcicd/deploy.json'), 'utf8'));
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(metadata.repository)) throw new Error('Repository tidak valid.');
  const file = await open(join(homedir(), 'coolify-token.conf'), constants.O_RDONLY | constants.O_NOFOLLOW);
  let token;
  try {
    const info = await file.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077) throw new Error('File token harus milik pengguna dengan izin 0600.');
    token = parseToken(await file.readFile('utf8'));
  } finally {
    await file.close();
  }
  return {
    repository: metadata.repository,
    config: readConfig({ COOLIFY_URL: metadata.coolify_url, COOLIFY_APP_UUID: metadata.application_uuid,
      COOLIFY_CONFIG_TOKEN: token, COOLIFY_DEPLOY_TOKEN: token, GITHUB_SHA: sha }),
  };
}

export async function withDeploymentLock(callback, lockPath = join(stateDirectory, 'deploy.flock')) {
  await mkdir(dirname(lockPath), { recursive: true, mode: 0o700 });
  const handle = await open(lockPath, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.uid !== process.getuid() || info.mode & 0o077) throw new Error('Izin lock deployment tidak aman.');
    const code = await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/flock', ['-n', '3'], { stdio: ['ignore', 'ignore', 'ignore', handle.fd] });
      child.once('error', reject);
      child.once('exit', (status) => resolve(status));
    });
    if (code === 1) return { status: 'locked' };
    if (code !== 0) throw new Error('Gagal memperoleh lock deployment.');
    return await callback();
  } finally {
    await handle.close();
  }
}
