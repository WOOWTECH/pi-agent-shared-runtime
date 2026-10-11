import fs from 'node:fs';
import path from 'node:path';
import { commandPath, locations, ROOT, run, saveJSON, readJSON, atomic, safeError, locked } from './common.mjs';
import { synchronize } from './sync.mjs';

export function installMissing(loc = locations(), executor = run) {
  const wrappers = path.join(loc.home, '.local/pi-shared/bin');
  const result = {};
  for (const [name, packageName] of [['claude', '@anthropic-ai/claude-code'], ['codex', '@openai/codex']]) {
    let binary = commandPath(name, process.env, [wrappers]);
    const local = path.join(loc.home, '.local/bin', name);
    if (!binary && fs.existsSync(local)) binary = local;
    let installed = false;
    try {
      if (!binary) {
        const npm = commandPath('npm');
        if (!npm) throw new Error('npm unavailable; Node 22.19+ and npm are prerequisites');
        // No update call when a usable installation already exists.
        const pin = process.env[`PI_SHARED_${name.toUpperCase()}_VERSION`];
        if (pin && !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pin)) throw new Error('CLI version pin must be an exact version');
        executor(npm, ['install', '--global', '--prefix', path.join(loc.home, '.local'), pin ? `${packageName}@${pin}` : packageName], { timeout: 600000 });
        binary = local; installed = true;
      }
      const version = executor(binary, ['--version'], { timeout: 20000 });
      result[name] = { binary, version: version.split('\n')[0], installed, status: 'available' };
    } catch (e) { result[name] = { status: 'failed', error: safeError(e), installed }; }
  }
  saveJSON(path.join(loc.state, 'clis.json'), result);
  return result;
}
export function installProfiles(loc = locations()) {
  const file = path.join(loc.home, '.profile');
  const start = '# BEGIN pi-agent-shared-runtime', end = '# END pi-agent-shared-runtime';
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const pattern = /# BEGIN pi-agent-shared-runtime\n[\s\S]*?# END pi-agent-shared-runtime\n?/g;
  text = text.replace(pattern, '');
  atomic(file, `${text.trimEnd()}\n\n${start}\nif [ -d "$HOME/.local/pi-shared/bin" ]; then\n  case "$PATH" in\n    "$HOME/.local/pi-shared/bin":*) ;;\n    *) PATH="$HOME/.local/pi-shared/bin:$PATH" ;;\n  esac\nfi\ncase ":$PATH:" in\n  *":$HOME/.local/bin:"*) ;;\n  *) PATH="$HOME/.local/bin:$PATH" ;;\nesac\nexport PATH\n${end}\n`);
  // Bash ignores .profile if either of these exists; append a narrow managed path block.
  for (const name of ['.bash_profile', '.bash_login', '.bashrc']) {
    const p = path.join(loc.home, name);
    if (!fs.existsSync(p)) continue;
    let s = fs.readFileSync(p, 'utf8').replace(pattern, '');
    s += `\n${start}\nif [ -d "$HOME/.local/pi-shared/bin" ]; then\n  case "$PATH" in "$HOME/.local/pi-shared/bin":*) ;; *) PATH="$HOME/.local/pi-shared/bin:$PATH" ;; esac\n  export PATH\nfi\n${end}\n`;
    atomic(p, s);
  }
  fs.mkdirSync(path.join(loc.home, '.local/pi-shared/bin'), { recursive: true });
  for (const name of ['claude', 'codex']) {
    const recorded = loc.state ? readJSON(path.join(loc.state, 'clis.json')) : {};
    const binary = recorded[name]?.binary || commandPath(name, process.env, [path.join(loc.home, '.local/pi-shared/bin')]) || path.join(loc.home, '.local/bin', name);
    const wrapper = `#!/usr/bin/env node\nimport { spawn } from 'node:child_process';\nimport { existsSync } from 'node:fs';\nconst cli=${JSON.stringify(path.join(ROOT, 'bin/cli.mjs'))};\nconst present=existsSync(cli);\nconst child = spawn(present?${JSON.stringify(process.execPath)}:${JSON.stringify(binary)}, present?[cli, 'run-cli', '${name}', ...process.argv.slice(2)]:process.argv.slice(2), {stdio:'inherit'});\nchild.on('error',()=>process.exit(1));\nfor (const signal of ['SIGINT','SIGTERM','SIGHUP']) process.on(signal,()=>child.kill(signal));\nchild.on('exit',code=>process.exit(code??1));\n`;
    atomic(path.join(loc.home, '.local/pi-shared/bin', name), wrapper, 0o755);
  }
}
export async function initialize(loc = locations()) {
  return locked(path.join(loc.state, 'initialize.lock'), async () => {
    const result = { date: new Date().toISOString(), cli: installMissing(loc) };
    installProfiles(loc);
    try { result.sync = await synchronize({ cwd: loc.home, loc }); }
    catch (e) { result.syncError = safeError(e); }
    for (const name of ['claude', 'codex']) {
      const info = result.cli[name];
      if (info.status !== 'available') continue;
      try {
        const raw = run(info.binary, name === 'codex' ? ['login', 'status'] : ['auth', 'status'], { timeout: 15000 });
        const parsed = name === 'claude' ? JSON.parse(raw) : null;
        info.auth = name === 'codex' ? 'logged-in' : parsed.loggedIn ? 'logged-in' : 'login-required';
      } catch { info.auth = 'login-required-or-status-unavailable'; }
    }
    result.status = result.syncError || Object.values(result.cli).some(c => c.status === 'failed') || result.sync?.conflicts?.length ? 'partial' : 'ready';
    saveJSON(path.join(loc.state, 'last-initialize.json'), result);
    return result;
  });
}
export function latest(loc = locations()) { return readJSON(path.join(loc.state, 'last-initialize.json')); }
