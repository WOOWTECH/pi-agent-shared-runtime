import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { locations, ROOT, safeError, readJSON } from './common.mjs';

export async function sdk() {
  try { return await import('@earendil-works/pi-coding-agent'); }
  catch (e) { if (e.code !== 'ERR_MODULE_NOT_FOUND') throw e; }
  const bases = [ROOT, process.cwd(), process.env.PI_SHARED_SDK_ROOT, '/usr/local/lib/node_modules/@agegr/pi-web', '/usr/local/lib/node_modules', '/opt/pi-web'].filter(Boolean);
  for (const base of bases) {
    try {
      const candidate = path.join(base, base.endsWith('node_modules') ? '' : 'node_modules', '@earendil-works/pi-coding-agent');
      const manifest = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'));
      const entry = manifest.exports?.['.']?.import || manifest.module || manifest.main;
      return await import(pathToFileURL(path.join(candidate, entry)).href);
    } catch (e) { if (!['ENOENT', 'MODULE_NOT_FOUND', 'ERR_MODULE_NOT_FOUND'].includes(e.code)) throw e; }
  }
  throw new Error('Pi SDK unavailable; install this package in the Pi host with its peer dependencies.');
}
export async function loadResources(cwd = process.cwd(), loc = locations()) {
  const pi = await sdk();
  const settingsManager = pi.SettingsManager.create(cwd, loc.data);
  // Generated links must never become authoritative sources after a package is removed.
  const owned = new Set();
  try {
    for (const name of fs.readdirSync(loc.state).filter(n => /^sync-.*\.json$/.test(n))) {
      for (const link of readJSON(path.join(loc.state, name)).links || []) owned.add(path.join(link.target, 'SKILL.md'));
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const resources = await new pi.DefaultPackageManager({ cwd, agentDir: loc.data, settingsManager }).resolve();
  const paths = resources.skills.filter(r => r.enabled && !owned.has(r.path)).map(r => r.path);
  const authoritative = pi.loadSkills({ cwd, agentDir: loc.data, skillPaths: paths, includeDefaults: false });
  const loader = new pi.DefaultResourceLoader({ cwd, agentDir: loc.data, settingsManager,
    additionalExtensionPaths: process.env.PI_SHARED_BRIDGE === '1' ? [path.join(ROOT, 'extensions/global-mcp.ts')] : [],
    // Skills are resolved from the user's full Pi package settings above, but
    // this sharing runtime must not activate unrelated Pi plugin extensions.
    // In bridge mode, only the explicitly added global MCP adapter is loaded.
    noExtensions: process.env.PI_SHARED_BRIDGE === '1',
    skillsOverride: () => authoritative });
  await loader.reload();
  return { pi, loader, settingsManager };
}
export async function createRuntime(cwd = process.cwd(), loc = locations()) {
  process.env.PI_SHARED_BRIDGE = '1';
  const { pi, loader, settingsManager } = await loadResources(cwd, loc);
  const errors = [];
  const { session, extensionsResult } = await pi.createAgentSession({ cwd, agentDir: loc.data, settingsManager,
    resourceLoader: loader, sessionManager: pi.SessionManager.inMemory(cwd) });
  await session.bindExtensions({ mode: 'print', onError: e => errors.push(safeError(e)) });
  return { session, loader, extensionsResult, errors };
}
export function sourceStamp(loc = locations(), cwd = process.cwd()) {
  const files = [path.join(loc.data, 'settings.json'), path.join(loc.data, 'mcp.json'), path.join(loc.state, 'last-sync.json'), path.join(cwd, '.pi/settings.json'), path.join(cwd, '.pi/mcp.json')];
  return files.map(f => { try { const s = fs.statSync(f); return [f, s.mtimeMs, s.size]; } catch { return [f, 0]; } });
}
