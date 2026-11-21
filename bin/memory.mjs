#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { locations, enabled } from '../src/common.mjs';
import { memoryRead, memoryList, memoryWrite, memoryDelete } from '../src/memory.mjs';
const loc = locations();
const key = { type: 'string', pattern: '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$' };
const revision = { type: 'string', description: 'Revision returned by read. Required to prevent overwriting newer changes.' };
const tools = [
  { name: 'read', description: 'Read one shared memory on this host. Same source for Pi, Claude and Codex through every connected brand.', inputSchema: { type: 'object', properties: { key }, required: ['key'], additionalProperties: false } },
  { name: 'list', description: 'List shared memory keys on this host, without loading their content.', inputSchema: { type: 'object', properties: { prefix: { type: 'string' } }, additionalProperties: false } },
  { name: 'write', description: 'Save an explicitly requested durable fact to this host. Use expectedRevision=null only to create; read current revision before updating. Does not synchronize to other hosts.', inputSchema: { type: 'object', properties: { key, content: { type: 'string', maxLength: 16384 }, expectedRevision: { anyOf: [revision, { type: 'null' }] } }, required: ['key', 'content', 'expectedRevision'], additionalProperties: false } },
  { name: 'delete', description: 'Delete one shared memory on this host with its current revision.', inputSchema: { type: 'object', properties: { key, expectedRevision: revision }, required: ['key', 'expectedRevision'], additionalProperties: false } },
];
const server = new Server({ name: 'pi-shared-memory', version: '0.1.5' }, { capabilities: { tools: {} } });
const result = (data, isError = false) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError });
server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: enabled(loc) ? tools : [] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  try {
    if (!enabled(loc)) return result({ code: 'SHARED_RUNTIME_DISABLED' }, true);
    const { name, arguments: args = {} } = request.params;
    if (name === 'read') return result({ memory: memoryRead(loc, args.key) });
    if (name === 'list') return result({ memories: memoryList(loc, args.prefix) });
    if (name === 'write') return result({ memory: await memoryWrite(loc, args) });
    if (name === 'delete') return result(await memoryDelete(loc, args));
    return result({ code: 'UNKNOWN_TOOL' }, true);
  } catch (error) { return result({ code: /^MEMORY_[A-Z_]+$/.test(error.code || '') ? error.code : 'MEMORY_UNAVAILABLE' }, true); }
});
await server.connect(new StdioServerTransport());
