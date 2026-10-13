import fs from 'node:fs';
import path from 'node:path';
import { parse as parseToml, stringify as toml } from 'smol-toml';
import { atomic, digest, locations, readJSON, ROOT, saveJSON } from './common.mjs';
import { loadResources } from './pi.mjs';

export function syncLinks(skills, destinations, previous = []) {
  const managed = [], conflicts = [], removed = [];
  for (const dest of destinations) {
    fs.mkdirSync(dest, { recursive: true });
    for (const skill of skills) {
      if (!/^[a-zA-Z0-9_-]+$/.test(skill.name)) { conflicts.push({ name: skill.name, reason: 'invalid skill name' }); continue; }
      const source = fs.realpathSync(path.dirname(skill.filePath));
      const target = path.join(dest, skill.name);
      const old = previous.find(p => p.target === target);
      try {
        const st = fs.lstatSync(target);
        const current = st.isSymbolicLink() ? path.resolve(path.dirname(target), fs.readlinkSync(target)) : null;
        if (current === source) {
          // Existing identical user links stay user-owned unless recorded by us.
          if (old?.source === source) managed.push(old);
          continue;
        }
        if (old && current === old.source) fs.unlinkSync(target);
        else { conflicts.push({ name: skill.name, target, reason: 'existing user item preserved' }); continue; }
      } catch (e) { if (e.code !== 'ENOENT') throw e; }
      fs.symlinkSync(source, target, 'dir'); managed.push({ name: skill.name, source, target });
    }
  }
  for (const old of previous) {
    if (managed.some(p => p.target === old.target) || skills.some(p => path.join(path.dirname(old.target), p.name) === old.target)) continue;
    try {
      if (fs.lstatSync(old.target).isSymbolicLink() && path.resolve(path.dirname(old.target), fs.readlinkSync(old.target)) === old.source) {
        fs.unlinkSync(old.target); removed.push(old.name);
      }
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
  return { managed, conflicts, removed };
}
export function mergeClaude(file, entry, previousHash) {
  const data = readJSON(file); data.mcpServers ||= {};
  const existing = data.mcpServers.pi_shared_runtime;
  if (existing && digest(existing) !== previousHash && digest(existing) !== digest(entry)) return { conflict: 'Claude MCP name already owned by user' };
  data.mcpServers.pi_shared_runtime = entry; saveJSON(file, data);
  return { hash: digest(entry) };
}
export function mergeCodex(file, entry, previousHash) {
  let text = ''; try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const data = text.trim() ? parseToml(text) : {};
  const existing = data.mcp_servers?.pi_shared_runtime;
  if (existing && digest(existing) !== previousHash && digest(existing) !== digest(entry)) return { conflict: 'Codex MCP name already owned by user' };
  // Preserve all user bytes/comments outside the owned MCP table (including nested tables).
  const sections = [...text.matchAll(/^\s*\[([^\n]+)\]\s*$/gm)];
  let kept = text;
  for (let i = sections.length - 1; i >= 0; i--) {
    const key = sections[i][1].replaceAll('"', '');
    if (key === 'mcp_servers.pi_shared_runtime' || key.startsWith('mcp_servers.pi_shared_runtime.')) {
      kept = kept.slice(0, sections[i].index) + kept.slice(sections[i + 1]?.index ?? text.length);
    }
  }
  atomic(file, kept.trimEnd() + '\n\n' + toml({ mcp_servers: { pi_shared_runtime: entry } }));
  return { hash: digest(entry) };
}
export async function synchronize({ cwd = process.cwd(), loc = locations(), resourceProvider = loadResources } = {}) {
  const { loader } = await resourceProvider(cwd, loc);
  const found = loader.getSkills();
  const key = digest(cwd).slice(0, 16);
  const file = path.join(loc.state, `sync-${key}.json`);
  const old = readJSON(file);
  const global = cwd === loc.home;
  const destinations = global ? [path.join(loc.home, '.claude/skills'), path.join(loc.home, '.agents/skills'), path.join(loc.home, '.codex/skills')]
    : [path.join(cwd, '.claude/skills'), path.join(cwd, '.agents/skills')];
  const skills = found.skills.filter(s => fs.existsSync(s.filePath));
  const links = syncLinks(skills, destinations, old.links);
  const env = { PI_SHARED_DATA_DIR: loc.data, PI_SHARED_HOME: loc.home, PI_SHARED_BRIDGE: '1' };
  const claudeEntry = { type: 'stdio', command: process.execPath, args: [path.join(ROOT, 'bin/bridge.mjs')], env };
  const codexEntry = { command: process.execPath, args: [path.join(ROOT, 'bin/bridge.mjs')], env,
    startup_timeout_sec: 90, tool_timeout_sec: 120 };
  const claude = mergeClaude(path.join(loc.home, '.claude.json'), claudeEntry, old.claudeHash);
  const codex = mergeCodex(path.join(loc.home, '.codex/config.toml'), codexEntry, old.codexHash);
  const report = { date: new Date().toISOString(), cwd, skills: skills.map(s => ({ name: s.name, source: s.filePath })),
    links: links.managed, removed: links.removed, conflicts: [...links.conflicts, ...[claude, codex].filter(x => x.conflict)],
    claudeHash: claude.hash, codexHash: codex.hash,
    skillDiagnostics: found.diagnostics.map(d => ({ type: d.type, message: d.message?.replace(/https?:\/\/\S+/g, '[endpoint]') })),
    mcpNames: Object.keys(readJSON(path.join(loc.data, 'mcp.json')).mcpServers || {}),
    bridge: 'Shares Pi skills and configured global MCP only. Native Pi plugins/extensions are not loaded by the bridge.' };
  saveJSON(file, report); saveJSON(path.join(loc.state, 'last-sync.json'), report);
  return report;
}
