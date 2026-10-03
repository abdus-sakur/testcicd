import { execFileSync } from 'node:child_process';
import { chmod, copyFile, mkdir, readFile, rename, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const runtime = join(homedir(), '.local/lib/testcicd');
const release = join(runtime, 'releases', `${Date.now()}-${process.pid}`);
const units = join(homedir(), '.config/systemd/user');
await mkdir(release, { recursive: true, mode: 0o700 });
await mkdir(units, { recursive: true, mode: 0o700 });
for (const name of ['cd-auto.mjs', 'local-runtime.mjs', 'deploy.mjs']) {
  await copyFile(join(root, 'scripts', name), join(release, name));
  await chmod(join(release, name), 0o600);
}
const pointer = join(runtime, `current.${process.pid}.tmp`);
await symlink(release, pointer);
await rename(pointer, join(runtime, 'current'));
for (const name of ['testcicd-cd.service', 'testcicd-cd.timer']) {
  const template = await readFile(join(root, 'ops/systemd', name), 'utf8');
  const node = process.execPath.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%');
  const temporary = join(units, `${name}.${process.pid}.tmp`);
  await writeFile(temporary, template.replace('@NODE_BINARY@', node), { mode: 0o600, flag: 'wx' });
  await rename(temporary, join(units, name));
}
execFileSync('/usr/bin/systemctl', ['--user', 'daemon-reload'], { stdio: 'inherit' });
execFileSync('/usr/bin/systemctl', ['--user', 'enable', '--now', 'testcicd-cd.timer'], { stdio: 'inherit' });
console.log(JSON.stringify({ event: 'auto_cd_installed', interval_seconds: 120 }));
