import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const NAME = '@woowtech/pi-agent-shared-runtime';
export function locations(env = process.env) {
  const home = env.PI_SHARED_HOME || os.homedir();
  const data = env.PI_SHARED_DATA_DIR || env.PI_CODING_AGENT_DIR || env.PI_AGENT_DATA_DIR || path.join(home, '.pi/agent');
  return { home, data, state: path.join(data, 'shared-runtime'), cwd: process.cwd() };
}
export function readJSON(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`Invalid JSON configuration: ${path.basename(file)}`); }
}
export function atomic(file, text, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(tmp, text, { mode });
  fs.renameSync(tmp, file);
}
export function saveJSON(file, value) { atomic(file, JSON.stringify(value, null, 2) + '\n'); }
export function digest(value) {
  function canonical(v) {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
    return v;
  }
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
}
export function isSharedPackage(source, loc = locations()) {
  if (typeof source !== 'string') return false;
  if (source === 'npm:' + NAME || source.startsWith('npm:' + NAME + '@')) return true;
  if (/^git:https:\/\/github\.com\/WOOWTECH\/pi-agent-shared-runtime(?:\.git)?(?:[#@].*)?$/.test(source)) return true;
  const target = path.resolve(loc.data, source);
  if (target === ROOT) return true;
  try { return readJSON(path.join(target, 'package.json')).name === NAME; } catch { return false; }
}
export function enabled(loc = locations()) {
  return (readJSON(path.join(loc.data, 'settings.json')).packages || []).some(p => {
    const source = typeof p === 'string' ? p : p.source;
    return isSharedPackage(source, loc) && !(typeof p === 'object' && Array.isArray(p.extensions) && !p.extensions.length);
  });
}
/** Explicit migration only. Normal install/boot never changes a user's disabled selection. */
export function enableSharedPackage(loc = locations()) {
  const file = path.join(loc.data, 'settings.json');
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const settings = original === null ? {} : JSON.parse(original);
  const packages = settings.packages || [];
  let matched = false;
  const previousSources = [];
  settings.packages = packages.map(p => {
    if (!isSharedPackage(typeof p === 'string' ? p : p.source, loc)) return p;
    matched = true;
    previousSources.push(typeof p === 'string' ? p : p.source);
    if (typeof p === 'string') return ROOT;
    const next = { ...p, source: ROOT };
    for (const key of ['extensions', 'skills']) if (Array.isArray(next[key]) && next[key].length === 0) delete next[key];
    return next;
  });
  if (!matched) settings.packages.push(ROOT);
  const backup = original === null ? null : path.join(loc.state, 'enable-backups', `settings-${Date.now()}-${crypto.randomUUID()}.json`);
  if (backup) atomic(backup, original);
  const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  if (current !== original) throw new Error('Settings changed during enable; retry from the current settings');
  saveJSON(file, settings);
  return { enabled: enabled(loc), restartSessions: true, source: ROOT, previousSources, backup };
}
export function commandPath(name, env = process.env, exclude = []) {
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    const candidate = path.join(dir, name);
    if (exclude.some(p => candidate.startsWith(p + path.sep))) continue;
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch {}
  }
}
export function run(command, args, options = {}) {
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...options });
  if (r.error || r.status !== 0) throw new Error(`Command failed: ${path.basename(command)} (exit ${r.status ?? r.error?.code})`);
  return r.stdout.trim();
}
export function safeError(error) {
  return { type: error?.constructor?.name || 'Error', code: typeof error?.code === 'string' ? error.code : undefined,
    message: String(error?.message || error).replace(/https?:\/\/\S+/g, '[endpoint]').replace(/(?:Bearer\s+|sk-|ghp_|gho_)[\w.-]+/g, '[credential]').slice(0, 280) };
}
function processIdentity(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return { startTime: stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19],
      pidNamespace: fs.readlinkSync(`/proc/${pid}/ns/pid`) };
  } catch { return {}; }
}
/**
 * OS-backed arbitration. Never unlink the SQLite file: that would create a
 * second lock inode while another process still holds the first. SQLite releases
 * its file locks on process death, including SIGKILL; no recovery mutex is needed.
 * The directory record supports migration diagnostics, not mutual exclusion.
 * Drain old (pre-SQLite) callers before upgrading; mixed versions are not safe.
 */
export async function locked(file, action) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const databaseFile = file + '.sqlite';
  let fd;
  try {
    // Never open/close an existing database outside SQLite: POSIX close() of
    // ANY fd for that inode can release this process's other SQLite connection.
    fd = fs.openSync(databaseFile, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_RDWR, 0o600);
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
  const stat = fs.lstatSync(databaseFile);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('Unsafe lock database');
  const { DatabaseSync } = await import('node:sqlite');
  const database = new DatabaseSync(databaseFile, { timeout: 0 });
  let acquired = false, token;
  try {
    try { database.exec('BEGIN EXCLUSIVE'); acquired = true; }
    catch (error) {
      // SQLITE_BUSY and SQLITE_LOCKED. Callers choose whether/how long to retry.
      if (error.errcode === 5 || error.errcode === 6) return { busy: true };
      throw error;
    }
    if (fs.existsSync(file)) {
      if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Unsafe lock directory');
      const owner = readJSON(path.join(file, 'owner.json'));
      if (owner.protocol !== 'sqlite-v1') {
        // Conservative compatibility check for a pre-upgrade directory owner.
        // macOS has no /proc identity, so a reused live PID remains busy.
        try {
          if (!owner.pid) throw new Error('missing owner');
          process.kill(owner.pid, 0);
          const current = processIdentity(owner.pid);
          if ((owner.startTime && current.startTime && owner.startTime !== current.startTime) ||
              (owner.pidNamespace && current.pidNamespace && owner.pidNamespace !== current.pidNamespace)) throw new Error('lock process was replaced');
          return { busy: true };
        } catch (error) {
          if (error.code === 'EPERM') return { busy: true };
          if (!owner.pid && Date.now() - fs.statSync(file).mtimeMs < 30000) return { busy: true };
        }
      }
      // Only the exclusive transaction owner may recover this directory. New
      // callers cannot observe a stale owner and then remove a replacement lock.
      fs.rmSync(file, { recursive: true, force: true });
    }
    try { fs.mkdirSync(file, { mode: 0o700 }); }
    catch (error) { if (error.code === 'EEXIST') return { busy: true }; throw error; }
    token = crypto.randomUUID();
    saveJSON(path.join(file, 'owner.json'), { protocol: 'sqlite-v1', token, pid: process.pid, ...processIdentity(process.pid) });
    return await action();
  } finally {
    try {
      if (token && readJSON(path.join(file, 'owner.json')).token === token) fs.rmSync(file, { recursive: true, force: true });
    } finally {
      try { if (acquired) database.exec('ROLLBACK'); }
      finally { database.close(); }
    }
  }
}
