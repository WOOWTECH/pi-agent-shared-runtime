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
export async function loadResources(cwd = process.cwd(), loc = locations(), { bridge = false } = {}) {
  const pi = await sdk();
  const settingsManager = pi.SettingsManager.create(cwd, loc.data);
  // Generated links must never become authoritative sources after a package is removed.
  const owned = new Set();
  try {
    for (const name of fs.readdirSync(loc.state).filter(n => /^sync-.*\.json$/.test(n))) {
      for (const link of readJSON(path.join(loc.state, name)).links || []) {
        if (typeof link.target !== 'string' || typeof link.source !== 'string') continue;
        try {
          if (fs.lstatSync(link.target).isSymbolicLink() && path.resolve(path.dirname(link.target), fs.readlinkSync(link.target)) === path.resolve(link.source)) {
            owned.add(path.resolve(link.target, 'SKILL.md'));
          }
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const manager = new pi.DefaultPackageManager({ cwd, agentDir: loc.data, settingsManager });
  const resources = await resolveSkillSources(manager, owned);
  const paths = resources.skills.filter(r => r.enabled).map(r => r.path);
  const authoritative = pi.loadSkills({ cwd, agentDir: loc.data, skillPaths: paths, includeDefaults: false });
  const loader = new pi.DefaultResourceLoader({ cwd, agentDir: loc.data, settingsManager,
    // Resource discovery must not import user extension modules, even during
    // boot, watcher refresh or CLI launch. Preserve the full SDK skill resolver
    // above; only the explicit MCP runtime may load our own adapter. Do not
    // change process.env: normal provider children still need their extensions.
    additionalExtensionPaths: bridge ? [path.join(ROOT, 'extensions/global-mcp.ts')] : [],
    noExtensions: true,
    skillsOverride: () => authoritative });
  await loader.reload();
  return { pi, loader, settingsManager };
}

/**
 * Pi's resolver ranks auto-discovered .agents aliases before package resources,
 * then deduplicates by realpath. Filtering its final result loses the enabled
 * package source and makes synchronization oscillate. Remove only our current
 * aliases before that boundary; the SDK still applies package filters, project
 * precedence, disabling and deduplication. Never follow a receipt as authority.
 *
 * This is a guarded, per-instance SDK compatibility seam, not a prototype patch.
 * Its real-SDK regression is required on each supported distribution. An SDK
 * that changes or skips this boundary fails closed instead of losing skills or
 * resurrecting a removed package through a generated link.
 */
export async function resolveSkillSources(manager, owned) {
  if (!owned.size) return manager.resolve();
  const original = manager.toResolvedPaths;
  const ownMethod = Object.hasOwn(manager, 'toResolvedPaths');
  if (typeof original !== 'function') throw new Error('Unsupported Pi SDK skill resolution boundary');
  let observed = false;
  manager.toResolvedPaths = function (accumulator) {
    if (!(accumulator?.skills instanceof Map)) throw new Error('Unsupported Pi SDK skill accumulator');
    observed = true;
    for (const resourcePath of accumulator.skills.keys()) {
      if (typeof resourcePath !== 'string') throw new Error('Unsupported Pi SDK skill path');
      if (owned.has(path.resolve(resourcePath))) accumulator.skills.delete(resourcePath);
    }
    return original.call(this, accumulator);
  };
  try {
    const resources = await manager.resolve();
    if (!observed) throw new Error('Unsupported Pi SDK skill resolution flow');
    return resources;
  } finally {
    if (ownMethod) manager.toResolvedPaths = original;
    else delete manager.toResolvedPaths;
  }
}
export async function createRuntime(cwd = process.cwd(), loc = locations()) {
  const { pi, loader, settingsManager } = await loadResources(cwd, loc, { bridge: true });
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
