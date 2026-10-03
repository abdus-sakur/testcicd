import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export function readConfig(environment) {
  const required = ['COOLIFY_URL', 'COOLIFY_APP_UUID', 'COOLIFY_CONFIG_TOKEN', 'COOLIFY_DEPLOY_TOKEN', 'GITHUB_SHA'];
  for (const name of required) {
    if (!environment[name]?.trim()) throw new Error(`${name} wajib diisi.`);
  }
  const url = new URL(environment.COOLIFY_URL);
  const localHttp = url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((!localHttp && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('COOLIFY_URL harus origin HTTPS atau HTTP loopback tanpa credential, path, query, atau fragment.');
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(environment.COOLIFY_APP_UUID)) {
    throw new Error('COOLIFY_APP_UUID tidak valid.');
  }
  if (!/^[a-f0-9]{40}$/.test(environment.GITHUB_SHA)) {
    throw new Error('GITHUB_SHA harus SHA commit lengkap.');
  }
  return {
    origin: url.origin,
    uuid: environment.COOLIFY_APP_UUID,
    configToken: environment.COOLIFY_CONFIG_TOKEN,
    deployToken: environment.COOLIFY_DEPLOY_TOKEN,
    sha: environment.GITHUB_SHA,
  };
}

export async function deploy(config, dependencies = {}) {
  const fetchApi = dependencies.fetch ?? fetch;
  const wait = dependencies.sleep ?? sleep;
  async function api(path, method, token, body) {
    const response = await fetchApi(`${config.origin}/api/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Coolify API mengembalikan HTTP ${response.status}.`);
    try {
      return await response.json();
    } catch {
      throw new Error('Respons Coolify bukan JSON valid.');
    }
  }
  await api(`/applications/${config.uuid}`, 'PATCH', config.configToken, {
    git_commit_sha: config.sha,
    is_auto_deploy_enabled: false,
  });
  const queued = await api('/deploy', 'POST', config.deployToken, { uuid: config.uuid, force: false });
  const deployment = queued.deployments?.find((item) => item.resource_uuid === config.uuid);
  if (!deployment || !/^[a-zA-Z0-9_-]+$/.test(deployment.deployment_uuid ?? '')) {
    throw new Error('Coolify tidak mengembalikan deployment UUID yang valid.');
  }
  for (let attempt = 0; attempt < 90; attempt++) {
    const result = await api(`/deployments/${deployment.deployment_uuid}`, 'GET', config.configToken);
    if (result.status === 'finished') {
      if (result.commit !== config.sha) throw new Error('Commit deployment berbeda dari commit yang lolos CI.');
      return deployment.deployment_uuid;
    }
    if (['failed', 'cancelled'].includes(result.status)) {
      throw new Error(`Deployment Coolify berstatus ${result.status}.`);
    }
    if (!['queued', 'in_progress'].includes(result.status)) {
      throw new Error('Status deployment Coolify tidak dikenali.');
    }
    await wait(10_000);
  }
  throw new Error('Batas waktu deployment tercapai. Periksa Coolify sebelum deployment berikutnya.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const uuid = await deploy(readConfig(process.env));
    console.log(JSON.stringify({ event: 'deployment_finished', deployment_uuid: uuid }));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
