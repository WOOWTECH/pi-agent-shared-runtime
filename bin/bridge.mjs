#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createRuntime, sourceStamp } from '../src/pi.mjs';
import { locations, readJSON, digest, safeError, enabled } from '../src/common.mjs';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

process.env.PI_SHARED_BRIDGE = '1';
// Extensions sometimes log on startup. Keep stdout exclusive to MCP framing.
console.log = (...values) => console.error(...values.map(v => typeof v === 'string' ? v.replace(/https?:\/\/\S+/g, '[endpoint]') : '[Pi extension metadata]'));
const loc = locations();
let instance, pending, stamp;
async function runtime() {
  if (!enabled(loc)) throw new Error('Pi shared-runtime plugin disabled or removed');
  const next = digest(sourceStamp(loc));
  if (instance && next === stamp) return instance;
  if (!pending) pending = (async () => {
    if (instance) instance.session.dispose();
    instance = await createRuntime(process.cwd(), loc); stamp = next; return instance;
  })().finally(() => { pending = null; });
  return pending;
}
const output = (value, isError = false) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }], isError });
function safeName(name) { return /^[\w-]{1,60}$/.test(name) ? name : `${name.replace(/[^\w-]/g, '_').slice(0,45)}_${digest(name).slice(0,8)}`; }
function publicTools(r) {
  return r.session.getAllTools().filter(t => t.exposure !== 'hidden' && !['read', 'write', 'edit', 'bash', 'powershell', 'grep', 'find', 'ls', 'pi_shared_initialize', 'pi_shared_status'].includes(t.name));
}
const builtins = [
  { name: 'pi_shared_status', description: 'Read Pi shared skills, plugins, MCP configuration names and initialization status. No installation or mutations.', inputSchema: { type: 'object', properties: {} } },
  { name: 'Skill', description: 'Load the shared Pi skill by exact name, including companion dependencies such as grilling. Returns instructions only.', inputSchema: { type: 'object', properties: { skill: { type: 'string' } }, required: ['skill'] } },
  { name: 'pi_shared_search', description: 'Discover Pi extension tools by name or description, including MCP dispatch tools. Unknown/failed extensions are reported separately.', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
];
const server = new Server({ name: 'pi-agent-shared-runtime', version: readJSON(path.join(path.dirname(import.meta.filename), '../package.json')).version }, { capabilities: { tools: {} } });
let queue = Promise.resolve();
function serial(work) {
  const result = queue.then(work); queue = result.catch(() => {}); return result;
}
server.setRequestHandler(ListToolsRequestSchema, () => serial(async () => {
  const r = await runtime();
  return { tools: [...builtins, ...publicTools(r).map(t => ({ name: safeName(t.name), description: t.description,
    inputSchema: t.parameters || { type: 'object', properties: {} } }))] };
}));
server.setRequestHandler(CallToolRequestSchema, request => serial(async () => {
  try {
    const r = await runtime(); const { name, arguments: args = {} } = request.params;
    if (name === 'pi_shared_status') {
      const sync = readJSON(path.join(loc.state, 'last-sync.json'));
      const init = readJSON(path.join(loc.state, 'last-initialize.json'));
      return output({ cli: init.cli, status: init.status, watcher: readJSON(path.join(loc.state, 'watch-state.json')), skills: r.loader.getSkills().skills.map(s => s.name),
        tools: publicTools(r).map(t => t.name), packages: sync.configuredPackages, plugins: sync.plugins, mcp: sync.mcpNames,
        extensionErrors: (r.extensionsResult.errors || []).map(e => ({ path: e.path, reason: 'loading failed' })), runtimeErrors: r.errors,
        limits: ['Headless execution: interactive UI/session commands may be unavailable', 'Discovered tools are not proof of remote authentication or successful calls'] });
    }
    if (name === 'Skill') {
      const skill = r.loader.getSkills().skills.find(s => s.name === args.skill);
      if (!skill) return output('Skill not found in current Pi resources', true);
      return output(fs.readFileSync(skill.filePath, 'utf8'));
    }
    if (name === 'pi_shared_search') {
      const q = String(args.query).toLowerCase();
      return output(publicTools(r).filter(t => `${t.name} ${t.description}`.toLowerCase().includes(q)).slice(0, 30)
        .map(t => ({ name: safeName(t.name), piName: t.name, description: t.description, inputSchema: t.parameters })));
    }
    const tool = publicTools(r).find(t => safeName(t.name) === name);
    if (!tool || !r.session.getCallableToolNames().includes(tool.name)) return output('Tool not available in this Pi context', true);
    const id = `external-mcp-${crypto.randomUUID()}`;
    // SDK nested execution requires a caller message. Represent the real external
    // MCP request explicitly, without generating a Pi model turn or bypassing hooks.
    r.session.agent.state.messages = [
      ...r.session.agent.state.messages.filter(m => m.role === 'system'),
      { role: 'assistant', content: [{ type: 'toolCall', id, name: tool.name, arguments: args }],
        api: 'external-mcp', provider: 'pi-shared-runtime', model: 'external-mcp-client',
        stopReason: 'toolUse', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } }
    ];
    const outcome = await r.session.extensionRunner.createToolContext(id, undefined).executeTool(tool.name, args);
    return { content: outcome.result.content.map(c => c.type === 'text' || c.type === 'image' || c.type === 'audio' ? c : { type: 'text', text: JSON.stringify(c) }), isError: outcome.isError };
  } catch (e) { return output(safeError(e), true); }
}));
async function cleanup() { instance?.session.dispose(); await server.close(); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void cleanup().finally(() => process.exit(0)); });
await server.connect(new StdioServerTransport());
