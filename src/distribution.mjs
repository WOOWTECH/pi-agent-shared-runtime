import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { ROOT, NAME, atomic, digest, enabled, isSharedPackage, locked, readJSON, saveJSON } from './common.mjs';
import { synchronize } from './sync.mjs';

const sourceOf = entry => typeof entry === 'string' ? entry : entry?.source;
const read = file => { try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const ownBundle = source => typeof source === 'string' && path.resolve(source) === ROOT;

/** Distribution registration is seed-once. Updates never undo a user's removal,
 * disablement or selection of an externally managed copy of the same package. */
export async function seedDistribution(loc) {
  return locked(path.join(loc.state, 'distribution-seed.lock'), () => {
    const file = path.join(loc.data, 'settings.json'), markerFile = path.join(loc.state, 'distribution-seed.json');
    const before = read(file), settings = before === null ? {} : JSON.parse(before);
    if (!settings || Array.isArray(settings) || typeof settings !== 'object' || (settings.packages !== undefined && !Array.isArray(settings.packages))) throw new Error('Invalid Pi package settings');
    const packages = settings.packages || [], existing = packages.find(p => isSharedPackage(sourceOf(p), loc));
    if (existing) {
      const selected = ownBundle(sourceOf(existing));
      const state = { status: !selected ? 'external' : enabled(loc) ? 'enabled' : 'disabled', source: sourceOf(existing) };
      if (!fs.existsSync(markerFile)) saveJSON(markerFile, { schema: 1, ...state });
      return state;
    }
    if (fs.existsSync(markerFile)) return { status: 'removed' };
    settings.packages = [...packages, ROOT];
    if (read(file) !== before) throw new Error('Package settings changed during seed');
    saveJSON(file, settings);
    saveJSON(markerFile, { schema: 1, status: 'seeded', source: ROOT });
    return { status: 'enabled', seeded: true, source: ROOT };
  });
}

function claudeEntry(server) {
  return server.url ? { type: 'http', url: server.url, ...(server.headers ? { headers: server.headers } : {}) } : server;
}
function codexEntry(server) {
  if (server.url) return { url: server.url, ...(server.headers && Object.keys(server.headers).length ? { http_headers: server.headers } : {}) };
  return Object.fromEntries(['command', 'args', 'cwd', 'env'].filter(k => server[k] !== undefined && (k !== 'env' || Object.keys(server.env).length)).map(k => [k, server[k]]));
}
function backupAndWrite(file, before, after, loc) {
  if (before === after) return false;
  if (read(file) !== before) throw new Error('Provider configuration changed during migration');
  if (before !== null) atomic(path.join(loc.state, 'distribution-backups', `${path.basename(file)}-${crypto.randomUUID()}`), before);
  atomic(file, after);
  return true;
}

/** Retire only unchanged definitions written by the old distribution helper.
 * Modified entries, unmarked Codex tables and unrelated user settings remain.
 * The old name list is retained: another session HOME may need its own migration. */
export function migrateLegacyMcp(loc) {
  const previous = readJSON(path.join(loc.data, '.shared-mcp-managed.json'), []);
  if (!Array.isArray(previous)) throw new Error('Invalid legacy MCP ownership record');
  const servers = readJSON(path.join(loc.data, 'mcp.json')).mcpServers || {};
  const names = previous.filter(name => typeof name === 'string' && Object.hasOwn(servers, name));
  const report = { claudeRemoved: [], codexRemoved: [], preserved: [] };
  const cf = path.join(loc.home, '.claude.json'), before = read(cf);
  if (before !== null) {
    const value = JSON.parse(before);
    for (const name of names) {
      if (!Object.hasOwn(value.mcpServers || {}, name)) continue;
      if (digest(value.mcpServers[name]) === digest(claudeEntry(servers[name]))) { delete value.mcpServers[name]; report.claudeRemoved.push(name); }
      else report.preserved.push({ provider: 'claude', name });
    }
    if (report.claudeRemoved.length) backupAndWrite(cf, before, JSON.stringify(value, null, 2) + '\n', loc);
  }
  const tf = path.join(loc.home, '.codex/config.toml'), text = read(tf);
  if (text !== null) {
    const after = text.replace(/# BEGIN pi-agent shared MCP \(managed\)\n([\s\S]*?)# END pi-agent shared MCP \(managed\)\n?/g, (block, body) => {
      const parsed = parseToml(body), removable = new Set();
      for (const name of names) {
        if (!Object.hasOwn(parsed.mcp_servers || {}, name)) continue;
        if (digest(parsed.mcp_servers[name]) === digest(codexEntry(servers[name]))) { removable.add(name); report.codexRemoved.push(name); }
        else report.preserved.push({ provider: 'codex', name });
      }
      let skip = false;
      const retained = body.split('\n').filter(line => {
        if (/^\s*\[/.test(line)) {
          const name = line.match(/^\s*\[mcp_servers\.(?:"([A-Za-z0-9_.-]+)"|([A-Za-z0-9_-]+))(?:\.|\])/)?.slice(1).find(Boolean);
          skip = removable.has(name);
        }
        return !skip;
      }).join('\n');
      return retained.trim() ? '# BEGIN pi-agent shared MCP (managed)\n' + retained + '# END pi-agent shared MCP (managed)\n' : '';
    });
    if (after !== text) backupAndWrite(tf, text, after, loc);
  }
  return report;
}

/** Provider HOME remains the caller's; canonical data determines shared memory.
 * This never invokes installProfiles/installMissing or replaces a user's HOME. */
export async function synchronizeDistribution({ loc, resourceProvider } = {}) {
  const registration = await seedDistribution(loc);
  if (registration.status !== 'enabled') return registration;
  return locked(path.join(loc.state, 'initialize.lock'), async () => {
    const migration = migrateLegacyMcp(loc);
    const sync = await synchronize({ cwd: loc.home, loc, ...(resourceProvider ? { resourceProvider } : {}) });
    return { status: 'ready', registration, migration, sync };
  });
}
