import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { memoryRead, memoryList, memoryWrite, memoryDelete } from '../src/memory.mjs';
import { ROOT, enabled, enableSharedPackage } from '../src/common.mjs';
import { mergeMemoryServer, synchronize } from '../src/sync.mjs';
const exec = promisify(execFile);
function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-memory-'));
  const data = path.join(home, 'agent'), state = path.join(data, 'shared-runtime');
  fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ packages: [ROOT] }));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, data, state };
}
async function client(t, loc, script = 'memory.mjs') {
  const c = new Client({ name: 'shared-memory-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'bin', script)], cwd: loc.home, stderr: 'pipe', env: { ...process.env, PI_SHARED_HOME: loc.home, PI_SHARED_DATA_DIR: loc.data, PI_SHARED_INTERNAL: '1' } });
  await c.connect(transport); t.after(() => c.close()); return c;
}
function parsed(result) { assert.equal(result.isError, false, JSON.stringify(result)); return JSON.parse(result.content[0].text); }
test('same-host clients share durable memory; a separate host data root cannot see it', async t => {
  const a = fixture(t), b = fixture(t), claude = await client(t, a), codex = await client(t, a), pi = await client(t, a), otherHost = await client(t, b);
  const marker = 'HOST_LOCAL_' + crypto.randomUUID();
  const saved = parsed(await claude.callTool({ name: 'write', arguments: { key: 'acceptance', content: marker, expectedRevision: null } })).memory;
  for (const c of [codex, pi]) assert.equal(parsed(await c.callTool({ name: 'read', arguments: { key: 'acceptance' } })).memory.content, marker);
  assert.equal(parsed(await otherHost.callTool({ name: 'read', arguments: { key: 'acceptance' } })).memory, null);
  assert.deepEqual(memoryList(a).map(m => m.key), ['acceptance']);
  const changed = parsed(await codex.callTool({ name: 'write', arguments: { key: 'acceptance', content: marker + '_UPDATED', expectedRevision: saved.revision } })).memory;
  const stale = await pi.callTool({ name: 'write', arguments: { key: 'acceptance', content: 'LOST', expectedRevision: saved.revision } });
  assert.equal(stale.isError, true); assert.equal(JSON.parse(stale.content[0].text).code, 'MEMORY_CONFLICT');
  parsed(await pi.callTool({ name: 'delete', arguments: { key: 'acceptance', expectedRevision: changed.revision } }));
  assert.equal(memoryRead(a, 'acceptance'), null);
});
test('multiple processes recovering a stale lock cannot overwrite a concurrent create or stale revision', async t => {
  const loc = fixture(t), url = new URL('../src/memory.mjs', import.meta.url).href;
  memoryList(loc);
  const lock = path.join(loc.state, 'memory/.lock');fs.mkdirSync(lock);fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: 2147483647 }));
  const source = `import {memoryWrite} from ${JSON.stringify(url)};try{await memoryWrite(${JSON.stringify(loc)},{key:'race',content:process.argv[1],expectedRevision:null});console.log('ok')}catch(e){console.log(e.code)}`;
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => exec(process.execPath, ['--input-type=module', '-e', source, 'writer-' + i])));
  assert.equal(results.filter(r => r.stdout.trim() === 'ok').length, 1);
  assert.equal(results.filter(r => r.stdout.trim() === 'MEMORY_CONFLICT').length, 7, JSON.stringify(results.map(r => r.stdout.trim())));
  assert.match(memoryRead(loc, 'race').content, /^writer-/);
});
test('memory rejects traversal, symlinks, corrupt state and oversized writes', async t => {
  const loc = fixture(t);
  await assert.rejects(memoryWrite(loc, { key: '../escape', content: 'bad', expectedRevision: null }), { code: 'MEMORY_INVALID_KEY' });
  await assert.rejects(memoryWrite(loc, { key: 'large', content: 'a'.repeat(16385), expectedRevision: null }), { code: 'MEMORY_INVALID_CONTENT' });
  memoryList(loc);
  const dir = path.join(loc.state, 'memory'), outside = path.join(loc.home, 'outside'); fs.writeFileSync(outside, 'unchanged');
  fs.symlinkSync(outside, path.join(dir, 'link.json'));
  await assert.rejects(memoryWrite(loc, { key: 'link', content: 'bad', expectedRevision: null }), { code: 'MEMORY_UNSAFE_FILE' });
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
  fs.writeFileSync(path.join(dir, 'corrupt.json'), '{');
  assert.throws(() => memoryRead(loc, 'corrupt'), { code: 'MEMORY_CORRUPT' });
  const other = fixture(t); fs.symlinkSync(loc.state, path.join(other.state, 'memory'));
  assert.throws(() => memoryRead(other, 'x'), { code: 'MEMORY_UNSAFE_DIRECTORY' });
});
test('owned global memory registration preserves unrelated MCP and refuses user name conflicts', t => {
  const loc = fixture(t), file = path.join(loc.data, 'mcp.json');
  fs.writeFileSync(file, JSON.stringify({ extra: true, mcpServers: { existing: { command: 'keep' } } }));
  const first = mergeMemoryServer(loc); assert.ok(first.hash);
  const d = JSON.parse(fs.readFileSync(file)); assert.equal(d.mcpServers.existing.command, 'keep'); assert.equal(d.extra, true);
  d.mcpServers.pi_shared_memory = { command: 'user-owned' }; fs.writeFileSync(file, JSON.stringify(d));
  assert.ok(mergeMemoryServer(loc).conflict); assert.equal(JSON.parse(fs.readFileSync(file)).mcpServers.pi_shared_memory.command, 'user-owned');
});
test('disabled settings remain disabled until explicit migration, preserving unrelated selections', async t => {
  const loc = fixture(t), file = path.join(loc.data, 'settings.json');
  fs.writeFileSync(file, JSON.stringify({ theme: 'keep', packages: [{ source: ROOT, extensions: [], skills: [], prompts: [] }, { source: 'user', extensions: [] }] }));
  assert.equal(enabled(loc), false);
  const c = await client(t, loc); assert.deepEqual((await c.listTools()).tools, []);
  assert.equal((await c.callTool({ name: 'read', arguments: { key: 'x' } })).isError, true);
  const migration = enableSharedPackage(loc); assert.equal(enabled(loc), true);
  assert.equal(JSON.parse(fs.readFileSync(migration.backup)).packages[0].extensions.length, 0);
  const settings = JSON.parse(fs.readFileSync(file)); assert.equal(settings.theme, 'keep'); assert.deepEqual(settings.packages[1], { source: 'user', extensions: [] }); assert.deepEqual(settings.packages[0].prompts, []);
  assert.ok((await c.listTools()).tools.some(x => x.name === 'write'));
});
test('real shared bridge invokes memory MCP and sync exposes the common skill to all providers', async t => {
  const loc = fixture(t);
  await synchronize({ cwd: loc.home, loc });
  for (const target of ['.claude/skills', '.codex/skills', '.agents/skills']) assert.match(fs.readFileSync(path.join(loc.home, target, 'shared-host-memory/SKILL.md'), 'utf8'), /MEMORY_CONFLICT/);
  const bridge = await client(t, loc, 'bridge.mjs');
  const connected = await bridge.callTool({ name: 'pi_global_mcp', arguments: { connect: 'pi_shared_memory' } });
  assert.equal(connected.isError, false, JSON.stringify(connected));
  const marker = 'BRIDGE_' + crypto.randomUUID();
  const write = await bridge.callTool({ name: 'pi_global_mcp', arguments: { tool: 'pi_shared_memory_write', args: { key: 'bridge', content: marker, expectedRevision: null } } });
  assert.equal(write.isError, false, JSON.stringify(write)); assert.equal(memoryRead(loc, 'bridge').content, marker);
  const nativePi = await client(t, loc);
  assert.equal(parsed(await nativePi.callTool({ name: 'read', arguments: { key: 'bridge' } })).memory.content, marker);
});

test('explicit enable migrates an old local package path to this version and retains backup', t => {
  const loc = fixture(t), old = path.join(loc.home, 'old-install'); fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'package.json'), JSON.stringify({ name: '@woowtech/pi-agent-shared-runtime', version: '0.1.4' }));
  const file = path.join(loc.data, 'settings.json');
  const before = JSON.stringify({ packages: [{ source: old, extensions: [], skills: [], themes: [] }, 'user-package'], defaultProvider: 'keep' });
  fs.writeFileSync(file, before);
  const migrated = enableSharedPackage(loc), after = JSON.parse(fs.readFileSync(file));
  assert.equal(after.packages[0].source, ROOT); assert.deepEqual(after.packages[0].themes, []); assert.equal(after.packages[1], 'user-package'); assert.equal(after.defaultProvider, 'keep');
  assert.equal(fs.readFileSync(migrated.backup, 'utf8'), before);
  assert.equal(fs.statSync(migrated.backup).mode & 0o777, 0o600);
});
