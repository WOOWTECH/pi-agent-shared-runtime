import fs from 'node:fs';
import path from 'node:path';
import { enabled, locations, readJSON, safeError } from './common.mjs';

// Read-only deployment probe. Never starts a model, scans extensions or installs.
export function health(loc = locations()) {
  const issues = [];
  try {
    if (!enabled(loc)) issues.push('plugin-disabled');
    const init = readJSON(path.join(loc.state, 'last-initialize.json'));
    const sync = readJSON(path.join(loc.state, 'last-sync.json'));
    const watch = readJSON(path.join(loc.state, 'watch-state.json'));
    if (!init.date) issues.push('initialization-missing');
    for (const name of ['claude', 'codex']) {
      const cli = init.cli?.[name];
      if (cli?.status !== 'available' || !cli.binary || !fs.existsSync(cli.binary)) issues.push(`${name}-unavailable`);
    }
    if (!sync.date) issues.push('sync-missing');
    if (sync.conflicts?.length) issues.push('sync-conflicts');
    if (sync.extensionErrors?.length) issues.push('extension-errors');
    if (sync.skillDiagnostics?.some(d => d.type === 'error')) issues.push('skill-errors');
    if (watch.status !== 'active') issues.push(`watch-${watch.status || 'missing'}`);
    const owner = readJSON(path.join(loc.state, 'watch.lock/owner.json'));
    try {
      if (!owner.pid) throw new Error('no owner');
      process.kill(owner.pid, 0);
      if (owner.startTime) {
        const stat=fs.readFileSync(`/proc/${owner.pid}/stat`, 'utf8');
        if (stat.slice(stat.lastIndexOf(')')+2).split(' ')[19] !== owner.startTime) throw new Error('replaced owner');
      }
      if (owner.pidNamespace && fs.readlinkSync(`/proc/${owner.pid}/ns/pid`) !== owner.pidNamespace) throw new Error('replaced namespace');
    } catch { issues.push('watch-process-unavailable'); }
    return { healthy: issues.length === 0, issues, watch: watch.status, lastSync: sync.date,
      authentication: Object.fromEntries(['claude','codex'].map(n=>[n,init.cli?.[n]?.auth || 'unknown'])),
      scope: 'Local runtime readiness only; cached authentication and remote MCP availability require live checks' };
  } catch (e) { return { healthy: false, issues: ['configuration-unreadable'], error: safeError(e) }; }
}
