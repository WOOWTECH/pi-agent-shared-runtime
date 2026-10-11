import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { atomic, commandPath, locations, ROOT, readJSON, saveJSON, enabled, digest, locked, safeError } from './common.mjs';
import { initialize, installProfiles } from './runtime.mjs';
import { synchronize } from './sync.mjs';

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
export async function api(route, body, { method = 'POST', cookie, port = process.env.PORT || process.env.PI_WEB_PORT || '30141' } = {}) {
  if (!/^\d{1,5}$/.test(String(port))) throw new Error('Invalid local Pi Web port');
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Pi Web API ${route} HTTP ${response.status}`);
  return response;
}
async function cookieForWeb() {
  if (!process.env.PI_WEB_PASSWORD) return undefined;
  const response = await api('/api/web-auth', { password: process.env.PI_WEB_PASSWORD });
  return response.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}
export async function ensureConversation(bootKey, loc, cookie) {
  const file = path.join(loc.state, `boot-${digest(bootKey).slice(0, 16)}.json`);
  let record = readJSON(file);
  if (record.sessionId) return { ...record, file };
  // Store before sending so a crash/unknown creation never leads to blind duplication.
  if (record.creation === 'pending') throw new Error('Previous initialization conversation creation is uncertain; inspect Pi Web sessions before retrying');
  record = { bootKey, creation: 'pending', date: new Date().toISOString() }; saveJSON(file, record);
  try {
    const response = await api('/api/agent/new', { cwd: loc.home, type: 'ensure_session' }, { cookie });
    const created = await response.json();
    if (!created.sessionId) throw new Error('Pi Web did not return a session id');
    record.sessionId = created.sessionId; record.creation = 'created'; saveJSON(file, record);
  } catch (e) { record.error = safeError(e); saveJSON(file, record); throw e; }
  try { await api(`/api/agent/${record.sessionId}`, { type: 'set_session_name', name: 'Claude / Codex 環境初始化' }, { cookie }); }
  catch (e) { record.namingError = safeError(e); saveJSON(file, record); }
  return { ...record, file };
}
export async function boot({ current = false, watch = false, loc = locations() } = {}) {
  if (!enabled(loc)) return { status: 'disabled' };
  const web = webProcess();
  const key = process.env.PI_SHARED_BOOT_ID || web?.key;
  if (!key) return { status: 'no-web-process', reason: 'Startup fallback requires a running Pi Web; use launch-web at service start' };
  const ownerPid = web?.pid;
  const result = await locked(path.join(loc.state, 'boot.lock'), async () => {
    let cookie;
    for (let i = 0; i < 120; i++) {
      try { cookie = await cookieForWeb(); await api('/api/sessions?summary=1', undefined, { method: 'GET', cookie }); break; }
      catch (e) {
        if (i === 119) throw e;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    const convo = await ensureConversation(key, loc, cookie);
    if (convo.initialized) {
      const clis = readJSON(path.join(loc.state, 'clis.json'));
      const missing = ['claude', 'codex'].some(name => !clis[name]?.binary || !fs.existsSync(clis[name].binary));
      if (!missing) installProfiles(loc);
      const refreshed = missing ? await initialize(loc)
        : await locked(path.join(loc.state, 'initialize.lock'), () => synchronize({ cwd: loc.home, loc }));
      if (refreshed.busy) return { status: 'busy' };
      return { status: 'already-initialized', sessionId: convo.sessionId, repairedMissingClis: missing };
    }
    const init = await initialize(loc);
    if (init.busy) return { status: 'busy' };
    const prompt = '這是使用者已授權的 Claude Code / Codex 環境初始化對話。安裝及同步已由插件的確定性程式執行。' +
      '請唯讀讀取 ' + path.join(loc.state, 'last-initialize.json') + '，以繁體中文回報版本、認證、技能同步、MCP/插件共享限制與失敗項目。' +
      '不得重複安裝、修改設定、部署、操作設備或發送訊息。已有工具名稱不代表遠端呼叫成功。';
    const record = readJSON(convo.file);
    record.initialized = true; record.result = init.status; record.prompt = 'pending'; saveJSON(convo.file, record);
    try {
      await api(`/api/agent/${convo.sessionId}`, { type: 'prompt', message: prompt }, { cookie });
      record.prompt = 'accepted'; saveJSON(convo.file, record);
    } catch (e) { record.prompt = 'uncertain-or-rejected'; record.promptError = safeError(e); saveJSON(convo.file, record); }
    return { status: init.status, sessionId: convo.sessionId, prompt: record.prompt };
  });
  if (!result.busy && result.status !== 'busy') saveJSON(path.join(loc.state, 'last-boot.json'), result);
  if (watch && !result.busy) {
    // One daemon per Web boot. Watch source files via inexpensive fs metadata, not model calls.
    const monitor = await import('./watch.mjs');
    await monitor.watchSources(loc, ownerPid);
  }
  return result;
}
