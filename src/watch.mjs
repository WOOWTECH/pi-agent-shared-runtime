import fs from 'node:fs';
import path from 'node:path';
import { digest, enabled, locked, saveJSON, safeError, readJSON } from './common.mjs';
import { synchronize } from './sync.mjs';

export function fingerprint(loc) {
  const rows = [], visited = new Set();
  function walk(dir, depth = 0) {
    if (depth > 7) return;
    let canonical; try { canonical = fs.realpathSync(dir); } catch { return; }
    if (visited.has(canonical)) return;
    visited.add(canonical);
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
  const sync = readJSON(path.join(loc.state, 'last-sync.json'));
  for (const skill of sync.skills || []) walk(path.dirname(skill.source));
  for (const plugin of sync.plugins || []) walk(path.dirname(plugin.path));
  return digest(rows);
}
export async function watchSources(loc, webPid, { intervalMs = 15000 } = {}) {
  await locked(path.join(loc.state, 'watch.lock'), () => new Promise(resolve => {
    let last = null, running = false, mode;
    function state(status) {
      if (status === mode) return;
      mode = status;
      saveJSON(path.join(loc.state, 'watch-state.json'), { status, date: new Date().toISOString() });
    }
    async function tick() {
      if (running) return;
      running = true;
      try {
        if (webPid) {
          try { process.kill(webPid, 0); } catch (e) {
            if (e.code !== 'ESRCH') throw e;
            clearInterval(timer); resolve(); return;
          }
        }
        // Settings can be temporarily incomplete while a GUI writer replaces them.
        // Never treat invalid configuration as disabled or remove managed links.
        if (!enabled(loc)) { last = null; state('paused'); return; }
        const next = fingerprint(loc);
        if (next !== last) {
          const result = await locked(path.join(loc.state, 'initialize.lock'), () => synchronize({ cwd: loc.home, loc }));
          if (result.busy) return;
          last = next;
        }
        fs.rmSync(path.join(loc.state, 'watch-error.json'), { force: true });
        state('active');
      } catch (e) {
        // Report recoverable faults and retry on the next interval, including
        // enabled()/fingerprint() failures and failures at initial startup.
        last = null;
        try {
          saveJSON(path.join(loc.state, 'watch-error.json'), safeError(e));
          state('degraded');
        } catch {} // A read-only/full filesystem must not cause an unhandled rejection.
      } finally { running = false; }
    }
    const timer = setInterval(tick, intervalMs);
    const stop = () => { clearInterval(timer); resolve(); };
    process.once('SIGTERM', stop); process.once('SIGINT', stop);
    void tick();
  }));
}
