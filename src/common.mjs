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
export function enabled(loc = locations()) {
  const settings = readJSON(path.join(loc.data, 'settings.json'));
  return (settings.packages || []).some(p => {
    const source = typeof p === 'string' ? p : p.source;
    if (!source) return false;
    const matches = source.includes(NAME) || path.resolve(loc.data, source) === ROOT;
    return matches && !(typeof p === 'object' && Array.isArray(p.extensions) && !p.extensions.length);
  });
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
export async function locked(file, action) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try { fs.mkdirSync(file); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const owner = readJSON(path.join(file, 'owner.json'));
    try { if (owner.pid) process.kill(owner.pid, 0); else throw new Error('missing owner'); }
    catch (e) {
      if (e.code === 'EPERM') return { busy: true };
      // Allow a just-created lock time to acquire an owner record.
      if (!owner.pid && Date.now() - fs.statSync(file).mtimeMs < 30000) return { busy: true };
      fs.rmSync(file, { recursive: true, force: true });
      return locked(file, action);
    }
    return { busy: true };
  }
  saveJSON(path.join(file, 'owner.json'), { pid: process.pid });
  try { return await action(); } finally { fs.rmSync(file, { recursive: true, force: true }); }
}
