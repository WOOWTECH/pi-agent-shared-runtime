import fs from 'node:fs';
import path from 'node:path';
import { digest, enabled, locked, saveJSON, safeError, readJSON } from './common.mjs';
import { synchronize } from './sync.mjs';

export function fingerprint(loc) {
  const rows = [];
  function walk(dir, depth = 0) {
    if (depth > 7) return;
    let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of entries) {
      if (['node_modules', '.git', 'sessions', 'shared-runtime', 'cache'].includes(ent.name)) continue;
      const f = path.join(dir, ent.name);
      try {
        const st = fs.statSync(f);
        rows.push([f, st.mtimeMs, st.size]);
        if (st.isDirectory()) walk(f, depth + 1);
      } catch { rows.push([f, 'missing']); }
    }
  }
  for (const file of ['settings.json', 'mcp.json']) {
    try { const s = fs.statSync(path.join(loc.data, file)); rows.push([file, s.mtimeMs, s.size]); } catch {}
  }
  for (const dir of ['skills', 'plugins', 'extensions']) walk(path.join(loc.data, dir));
  const settings = readJSON(path.join(loc.data, 'settings.json'));
  for (const item of settings.packages || []) {
    const source = typeof item === 'string' ? item : item.source;
    if (source && !/^(npm:|git:|https?:)/.test(source)) walk(path.resolve(loc.data, source));
  }
  for (const skill of readJSON(path.join(loc.state, 'last-sync.json')).skills || []) walk(path.dirname(skill.source));
  for (const plugin of readJSON(path.join(loc.state, 'last-sync.json')).plugins || []) walk(path.dirname(plugin.path));
  return digest(rows);
}
export async function watchSources(loc, webPid, { intervalMs = 15000 } = {}) {
  await locked(path.join(loc.state, 'watch.lock'), () => new Promise(resolve => {
    let last = fingerprint(loc), running = false, mode;
    function state(status) {
      if (status === mode) return;
      mode = status;
      saveJSON(path.join(loc.state, 'watch-state.json'), { status, date: new Date().toISOString() });
    }
    state('active');
    const timer = setInterval(async () => {
      if (webPid) {
        try { process.kill(webPid, 0); } catch { clearInterval(timer); resolve(); return; }
      }
      // The GUI enable switch only changes settings. Keep the lightweight
      // controller idle while disabled; no installs, models or source scans.
      if (!enabled(loc)) { last = null; state('paused'); return; }
      state('active');
      if (running) return;
      const next = fingerprint(loc);
      if (next === last) return;
      running = true;
      try {
        const result = await locked(path.join(loc.state, 'initialize.lock'), () => synchronize({ cwd: loc.home, loc }));
        if (!result.busy) last = next;
      }
      catch (e) { saveJSON(path.join(loc.state, 'watch-error.json'), safeError(e)); }
      finally { running = false; }
    }, intervalMs);
    const stop = () => { clearInterval(timer); resolve(); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
  }));
}
