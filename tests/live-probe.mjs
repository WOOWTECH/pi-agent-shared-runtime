// Explicit live, read-only integration probe; deliberately excluded from npm test.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs';
import { locations, ROOT, saveJSON, safeError } from '../src/common.mjs';
import path from 'node:path';
const report = { date: new Date().toISOString(), calls: [] };
const client = new Client({ name: 'pi-shared-live-probe', version: '1' });
const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'bin/bridge.mjs')],
  cwd: locations().home, stderr: 'pipe', env: { ...process.env, PI_SHARED_BRIDGE: '1' } });
try {
  await client.connect(transport);
  const tools = await client.listTools(); report.tools = tools.tools.map(t => t.name);
  for (const [name, args] of [
    ['pi_shared_status', {}],
    ['Skill', { skill: 'verification-before-completion' }],
    ['odoo19_call', { model: 'res.partner', method: 'search_count', args: '[[]]' }],
    ['google_drive', { action: 'list', limit: 1 }],
    ['pi_global_mcp', { connect: 'browserless' }],
  ]) {
    try {
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 90000 });
      // Store only success metadata; avoid documents, account data and server details.
      report.calls.push({ name, success: !result.isError, contentTypes: result.content.map(c => c.type),
        textBytes: result.content.reduce((n, c) => n + (c.text?.length || 0), 0) });
    } catch (e) { report.calls.push({ name, success: false, error: safeError(e) }); }
    console.log(JSON.stringify(report.calls.at(-1)));
  }
} finally {
  await client.close(); saveJSON(path.join(locations().state, 'live-probe.json'), report);
}
