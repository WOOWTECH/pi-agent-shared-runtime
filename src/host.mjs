import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { atomic, commandPath, locations, ROOT, readJSON, saveJSON, enabled, locked } from './common.mjs';
import { initialize } from './runtime.mjs';

export async function installHost({ auto = false, loc = locations() } = {}) {
  const shim = path.join(loc.home, '.local/bin/pi-web');
  const metadata = path.join(loc.state, 'host.json');
  const old = readJSON(metadata);
  let real = old.realWeb || commandPath('pi-web', process.env, [path.join(loc.home, '.local/bin')]);
  if (!real && fs.existsSync(shim)) {
    const s = fs.readFileSync(shim, 'utf8');
    if (!s.includes('pi-agent-shared-runtime launcher')) real = shim;
  }
  if (!real) {
    if (auto) return { status: 'host-unavailable', reason: 'Pi Web launcher not found; use launch-web after installation' };
    throw new Error('Pi Web launcher not found');
  }
  if (fs.existsSync(shim) && !fs.readFileSync(shim, 'utf8').includes('pi-agent-shared-runtime launcher')) {
    return { status: 'conflict', reason: 'Existing user pi-web launcher preserved; use pi-shared-runtime launch-web' };
  }
  const source = `#!/usr/bin/env node\n// pi-agent-shared-runtime launcher\nimport {spawn} from 'node:child_process';\nimport {existsSync} from 'node:fs';\nconst cli=${JSON.stringify(path.join(ROOT, 'bin/cli.mjs'))};\nconst present=existsSync(cli);\nconst child=spawn(present?${JSON.stringify(process.execPath)}:${JSON.stringify(real)},present?[cli,'launch-web',...process.argv.slice(2)]:process.argv.slice(2),{stdio:'inherit'});\nchild.on('error',()=>process.exit(1));\nfor(const s of ['SIGINT','SIGTERM','SIGHUP'])process.on(s,()=>child.kill(s));\nchild.on('exit',c=>process.exit(c??1));\n`;
  atomic(shim, source, 0o755);
  saveJSON(metadata, { realWeb: real, shim, root: ROOT, installedAt: new Date().toISOString() });
  return { status: 'installed', shim, realWeb: real };
}
export async function launchWeb(args = [], loc = locations()) {
  const real = readJSON(path.join(loc.state, 'host.json')).realWeb;
  if (!real) throw new Error('Host launcher is not configured; run install-host first');
  const env = { ...process.env, PI_SHARED_BOOT_ID: `${process.pid}-${Date.now()}` };
  const child = spawn(real, args, { stdio: 'inherit', env });
  let worker;
  if (enabled(loc)) {
    worker = spawn(process.execPath, [path.join(ROOT, 'bin/cli.mjs'), 'boot'], { stdio: ['ignore', 'inherit', 'inherit'], env });
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => { child.kill(signal); worker?.kill(signal); });
  child.once('exit', (code, signal) => { worker?.kill('SIGTERM'); process.exit(code ?? (signal ? 1 : 0)); });
  child.once('error', () => { worker?.kill('SIGTERM'); process.exit(1); });
}
function webProcess() {
  if (!fs.existsSync('/proc')) return null;
  for (const id of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
    try {
      const cmd = fs.readFileSync(`/proc/${id}/cmdline`, 'utf8').split('\0');
      if (!cmd.some(a => /(?:^|\/)pi-web(?:\.js)?$/.test(a)) || !cmd[0]?.includes('node')) continue;
      const stat = fs.readFileSync(`/proc/${id}/stat`, 'utf8');
      return { pid: Number(id), key: `${id}-${stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]}` };
    } catch {}
  }
  return null;
}
export async function boot({ current = false, watch = false, loc = locations() } = {}) {
  if (!enabled(loc)) return { status: 'disabled' };
  const web = webProcess();
  const key = process.env.PI_SHARED_BOOT_ID || web?.key;
  if (!key && !current) return { status: 'no-web-process', reason: 'Run through launch-web or pass --current from an active Pi Web extension' };
  const ownerPid = web?.pid;
  const result = await locked(path.join(loc.state, 'boot.lock'), async () => {
    const init = await initialize(loc);
    if (init.busy) return { status: 'busy' };
    return { status: init.status, initializedAt: new Date().toISOString(), bootKey: key };
  });
  if (!result.busy && result.status !== 'busy') saveJSON(path.join(loc.state, 'last-boot.json'), result);
  if (watch && !result.busy) {
    // One daemon per Web boot. Watch source files via inexpensive fs metadata, not model calls.
    const monitor = await import('./watch.mjs');
    await monitor.watchSources(loc, ownerPid);
  }
  return result;
}
