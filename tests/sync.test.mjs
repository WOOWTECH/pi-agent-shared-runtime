import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'smol-toml';
import { syncLinks, mergeClaude, mergeCodex } from '../src/sync.mjs';
import { locked, digest } from '../src/common.mjs';
import { installMissing, installProfiles } from '../src/runtime.mjs';
import { loadResources } from '../src/pi.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shared-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function skill(dir, name) {
  const file = path.join(dir, 'source', name, 'SKILL.md');
  fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `---\nname: ${name}\ndescription: test\n---\n`);
  return { name, filePath: file };
}
test('add/update/remove managed skills without deleting user-owned skills', t => {
  const dir = fixture(t), dest = path.join(dir, 'skills'), a = skill(dir, 'alpha');
  const first = syncLinks([a], [dest]); assert.equal(first.managed.length, 1);
  fs.mkdirSync(path.join(dest, 'user')); fs.writeFileSync(path.join(dest, 'user/SKILL.md'), 'user');
  const second = syncLinks([], [dest], first.managed);
  assert.deepEqual(second.removed, ['alpha']); assert.equal(fs.existsSync(path.join(dest, 'alpha')), false);
  assert.equal(fs.readFileSync(path.join(dest, 'user/SKILL.md'), 'utf8'), 'user');
});
test('existing identical links remain user-owned and survive source removal', t => {
  const dir = fixture(t), a = skill(dir, 'alpha'), dest = path.join(dir, 'skills');
  fs.mkdirSync(dest); fs.symlinkSync(path.dirname(a.filePath), path.join(dest, 'alpha'));
  const first = syncLinks([a], [dest]); assert.equal(first.managed.length, 0);
  syncLinks([], [dest], first.managed); assert.equal(fs.lstatSync(path.join(dest, 'alpha')).isSymbolicLink(), true);
});
test('rediscovered generated symlink remains canonical and never links to itself', t => {
  const dir = fixture(t), a = skill(dir, 'alpha'), dest = path.join(dir, 'skills');
  const first = syncLinks([a], [dest]);
  const discovered = { name: 'alpha', filePath: path.join(dest, 'alpha/SKILL.md') };
  const second = syncLinks([discovered], [dest], first.managed);
  assert.equal(second.conflicts.length, 0);
  assert.equal(fs.realpathSync(discovered.filePath), a.filePath);
  assert.equal(second.managed[0].source, path.dirname(a.filePath));
});
test('Pi-owned skill source is not reported as a destination conflict', t => {
  const dir = fixture(t), a = skill(dir, 'alpha');
  const piSource = path.dirname(path.dirname(a.filePath));
  const claude = path.join(dir, '.claude/skills');
  const codex = path.join(dir, '.codex/skills');
  const result = syncLinks([a], [piSource, claude, codex]);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.managed.length, 2);
  assert.equal(fs.lstatSync(path.join(claude, 'alpha')).isSymbolicLink(), true);
  assert.equal(fs.lstatSync(path.join(codex, 'alpha')).isSymbolicLink(), true);
});
test('MCP ownership digest survives TOML key reordering', t => {
  const file = path.join(fixture(t), 'config.toml');
  const entry = { command: 'node', args: ['bridge'], env: { Z: 'z', A: 'a' }, startup_timeout_sec: 90 };
  const first = mergeCodex(file, entry);
  assert.equal(mergeCodex(file, entry, first.hash).conflict, undefined);
  assert.equal(digest({ z: 1, a: 2 }), digest({ a: 2, z: 1 }));
});
test('disabled package cannot survive by rediscovering a generated skill link', async t => {
  const dir = fixture(t), data = path.join(dir, 'agent'), state = path.join(data, 'shared-runtime');
  const pkg = path.join(dir, 'package'), source = path.join(pkg, 'skills/regression-owned');
  fs.mkdirSync(source, { recursive: true }); fs.mkdirSync(state, { recursive: true });
  fs.writeFileSync(path.join(source, 'SKILL.md'), '---\nname: regression-owned\ndescription: fixture\n---\n');
  fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: 'regression-package', pi: { skills: ['skills'] } }));
  const settings = path.join(data, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ packages: [pkg] }));
  const loc = { home: dir, data, state };
  const first = (await loadResources(dir, loc)).loader.getSkills().skills;
  assert.ok(first.some(s => s.name === 'regression-owned'));
  const links = syncLinks(first.filter(s => s.name === 'regression-owned'), [path.join(dir, '.agents/skills')]);
  fs.writeFileSync(path.join(state, 'sync-fixture.json'), JSON.stringify({ links: links.managed }));
  fs.writeFileSync(settings, JSON.stringify({ packages: [] }));
  const second = (await loadResources(dir, loc)).loader.getSkills().skills;
  assert.equal(second.some(s => s.name === 'regression-owned'), false);
  const removed = syncLinks(second, [path.join(dir, '.agents/skills')], links.managed);
  assert.deepEqual(removed.removed, ['regression-owned']);
});
test('same-name user skills are preserved and reported as conflicts', t => {
  const dir = fixture(t), a = skill(dir, 'alpha'), dest = path.join(dir, 'skills');
  fs.mkdirSync(path.join(dest, 'alpha'), { recursive: true }); fs.writeFileSync(path.join(dest, 'alpha/SKILL.md'), 'user');
  const result = syncLinks([a], [dest]); assert.equal(result.conflicts.length, 1); assert.equal(result.managed.length, 0);
});
test('Codex merge preserves comments, unrelated MCP/env tables, and replaces only owned tables', t => {
  const dir = fixture(t), file = path.join(dir, 'config.toml');
  fs.writeFileSync(file, '# user comment\nmodel = "keep"\n[mcp_servers.original]\ncommand="keep"\n[mcp_servers.original.env]\nKEY="keep"\n');
  const e = { command: 'node', args: ['bridge'], env: { PI_SHARED_BRIDGE: '1' } };
  const first = mergeCodex(file, e); const second = mergeCodex(file, { ...e, args: ['new'] }, first.hash);
  const text = fs.readFileSync(file, 'utf8'), data = parse(text);
  assert.ok(text.startsWith('# user comment')); assert.equal(data.model, 'keep');
  assert.equal(data.mcp_servers.original.env.KEY, 'keep'); assert.deepEqual(data.mcp_servers.pi_shared_runtime.args, ['new']);
  assert.equal(second.hash, digest({ ...e, args: ['new'] }));
});
test('user-edit of owned MCP config is preserved and reported', t => {
  const dir = fixture(t), file = path.join(dir, '.claude.json');
  fs.writeFileSync(file, JSON.stringify({ userFlag: true, mcpServers: { pi_shared_runtime: { command: 'custom' } } }));
  const r = mergeClaude(file, { command: 'node' });
  assert.ok(r.conflict); assert.equal(JSON.parse(fs.readFileSync(file)).mcpServers.pi_shared_runtime.command, 'custom');
});
test('concurrent initialization lock yields busy, then releases', async t => {
  const dir = fixture(t), lock = path.join(dir, 'lock'); let release;
  const first = locked(lock, () => new Promise(r => { release = r; }));
  const second = await locked(lock, () => assert.fail('must not run twice')); assert.equal(second.busy, true);
  release('done'); assert.equal(await first, 'done'); assert.equal(fs.existsSync(lock), false);
});
test('missing-only install does not update existing installations', t => {
  const dir = fixture(t), bins = path.join(dir, 'bin'); fs.mkdirSync(bins);
  for (const name of ['claude', 'codex']) fs.writeFileSync(path.join(bins, name), '#!/bin/sh\n', { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = bins; t.after(() => { process.env.PATH = previous; });
  const calls = []; const r = installMissing({ home: dir, data: dir, state: path.join(dir, 'state') }, (cmd,args) => { calls.push(args); return 'test-version'; });
  assert.equal(calls.length, 2); assert.ok(calls.every(a => a[0] === '--version')); assert.equal(r.codex.installed, false);
});
test('missing CLI invokes installer once and then verifies the resulting executable', t => {
  const dir = fixture(t), bins = path.join(dir, 'bin'); fs.mkdirSync(bins);
  fs.writeFileSync(path.join(bins, 'npm'), '#!/bin/sh\n', { mode: 0o755 });
  const previous = process.env.PATH; process.env.PATH = bins; t.after(() => { process.env.PATH = previous; });
  const calls = []; installMissing({ home: dir, data: dir, state: path.join(dir, 'state') }, (cmd,args) => { calls.push({cmd,args}); return 'test-version'; });
  assert.equal(calls.filter(c => c.args[0] === 'install').length, 2);
  assert.equal(calls.filter(c => c.args[0] === '--version').length, 2);
});
test('profile hooks are idempotent and preserve existing shell customizations', t => {
  const dir = fixture(t); fs.writeFileSync(path.join(dir, '.bashrc'), 'export USER_FLAG=yes\n');
  installProfiles({ home: dir }); installProfiles({ home: dir });
  const text = fs.readFileSync(path.join(dir, '.bashrc'), 'utf8');
  assert.ok(text.startsWith('export USER_FLAG=yes')); assert.equal(text.match(/BEGIN pi-agent-shared-runtime/g).length, 1);
});

test('missing CLI honors exact deployment pins and rejects mutable tags before installation', t => {
  const dir=fixture(t),bins=path.join(dir,'bin');fs.mkdirSync(bins);
  fs.writeFileSync(path.join(bins,'npm'),'#!/bin/sh\n',{mode:0o755});
  const old={PATH:process.env.PATH,PI_SHARED_CLAUDE_VERSION:process.env.PI_SHARED_CLAUDE_VERSION,PI_SHARED_CODEX_VERSION:process.env.PI_SHARED_CODEX_VERSION};
  Object.assign(process.env,{PATH:bins,PI_SHARED_CLAUDE_VERSION:'2.1.296',PI_SHARED_CODEX_VERSION:'latest'});
  t.after(()=>{for(const [k,v]of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  const calls=[];const result=installMissing({home:dir,state:path.join(dir,'state')},(cmd,args)=>{calls.push(args);return 'fixture';});
  assert.equal(result.claude.status,'available');assert.equal(result.codex.status,'failed');
  const installs=calls.filter(a=>a[0]==='install');assert.equal(installs.length,1);
  assert.equal(installs[0].at(-1),'@anthropic-ai/claude-code@2.1.296');
});
