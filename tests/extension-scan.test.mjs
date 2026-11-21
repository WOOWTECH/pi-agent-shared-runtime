import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from '../src/common.mjs';

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-extension-scan-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const data = path.join(home, 'agent'), state = path.join(data, 'shared-runtime');
  const workspace = path.join(home, 'workspace'), pkg = path.join(home, 'fixture-package'), bin = path.join(home, 'bin');
  const events = path.join(home, 'extension-events.jsonl'), childReceipt = path.join(home, 'child.json');
  const write = (file, content) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); };
  for (const [name, file] of [['global', path.join(data, 'extensions/global.ts')], ['package', path.join(pkg, 'extension.ts')], ['project', path.join(workspace, '.pi/extensions/project.ts')]]) {
    write(file, `import fs from 'node:fs';\nconst record=event=>fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({source:${JSON.stringify(name)},event,caller:process.env.SENTINEL_CALLER||'scan'})+'\\n');\nrecord('import');\nexport default function(){record('activate');}\n`);
  }
  write(path.join(pkg, 'package.json'), JSON.stringify({ name: 'extension-scan-fixture', pi: { extensions: ['extension.ts'], skills: ['skills'] } }));
  write(path.join(pkg, 'skills/package-probe/SKILL.md'), '---\nname: package-probe\ndescription: sentinel fixture\n---\nPACKAGE_SKILL\n');
  write(path.join(data, 'settings.json'), JSON.stringify({ packages: [ROOT, pkg] }));
  write(path.join(data, 'mcp.json'), JSON.stringify({ mcpServers: {} }));
  const childCode = `#!${process.execPath}\nimport fs from 'node:fs';\nconst args=process.argv.slice(2);\nif(args.includes('--version'))console.log('fixture-version');\nelse if(args[0]==='auth')console.log(JSON.stringify({loggedIn:true}));\nelse if(args[0]==='login')console.log('logged in');\nelse {\n fs.writeFileSync(${JSON.stringify(childReceipt)},JSON.stringify({bridge:process.env.PI_SHARED_BRIDGE??null,internal:process.env.PI_SHARED_INTERNAL??null}));\n process.env.SENTINEL_CALLER='provider';\n const {sdk}=await import(${JSON.stringify(path.join(ROOT, 'src/pi.mjs'))});const pi=await sdk();\n // A real provider's ordinary SDK loader, with fixture packages only. The\n // shared bootstrap is excluded here so this control cannot launch workers.\n const loader=new pi.DefaultResourceLoader({cwd:${JSON.stringify(workspace)},agentDir:${JSON.stringify(data)},settingsManager:pi.SettingsManager.inMemory({packages:[${JSON.stringify(pkg)}]})});\n await loader.reload();\n if(loader.getExtensions().errors.length)throw Error('Normal provider extension load failed');\n}\n`;
  for (const name of ['claude', 'codex']) { const file = path.join(bin, name); write(file, childCode); fs.chmodSync(file, 0o755); }
  const env = { ...process.env, HOME: home, PI_SHARED_HOME: home, PI_SHARED_DATA_DIR: data, PI_CODING_AGENT_DIR: data,
    PI_SHARED_BOOT_ID: 'extension-scan-fixture', PATH: bin + path.delimiter + process.env.PATH };
  delete env.PI_SHARED_BRIDGE; delete env.PI_SHARED_INTERNAL; delete env.SENTINEL_CALLER;
  return { home, data, state, workspace, pkg, events, childReceipt, env, write };
}
function run(f, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, args, { cwd: f.workspace, env: { ...f.env, ...extraEnv }, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}
function noExtensions(f) { assert.equal(fs.existsSync(f.events), false, 'resource scan imported or activated a user extension'); }
function synchronized(f) {
  const report = JSON.parse(fs.readFileSync(path.join(f.state, 'last-sync.json')));
  assert.ok(report.skills.some(skill => skill.name === 'package-probe'));
  assert.ok(report.skills.some(skill => skill.name === 'shared-host-memory'));
  assert.ok(JSON.parse(fs.readFileSync(path.join(f.data, 'mcp.json'))).mcpServers.pi_shared_memory);
}
for (const [name, args] of [['sync-global', ['sync', '--global']], ['sync-workspace', ['sync']], ['initialize', ['initialize']], ['boot', ['boot', '--current', '--once']]]) {
  test(`real extension sentinel: CLI ${name} scans without imports`, t => {
    const f = fixture(t);
    run(f, [path.join(ROOT, 'bin/cli.mjs'), ...args]);
    synchronized(f); noExtensions(f);
    if (name === 'initialize' || name === 'boot') assert.equal(JSON.parse(fs.readFileSync(path.join(f.state, 'last-initialize.json'))).status, 'ready');
  });
}
for (const bridgeFlag of [undefined, '1']) test(`resource scan has zero extensions with inherited bridge=${bridgeFlag ?? 'unset'}`, t => {
  const f = fixture(t);
  const code = `import assert from 'node:assert/strict';import {loadResources} from ${JSON.stringify(path.join(ROOT, 'src/pi.mjs'))};const flags=()=>({bridge:process.env.PI_SHARED_BRIDGE??null,internal:process.env.PI_SHARED_INTERNAL??null});const before=flags();const {loader}=await loadResources(${JSON.stringify(f.workspace)});assert.equal(loader.getExtensions().extensions.length,0);assert.equal(loader.getExtensions().errors.length,0);assert.deepEqual(flags(),before);`;
  run(f, ['--input-type=module', '-e', code], { PI_SHARED_INTERNAL: '1', ...(bridgeFlag ? { PI_SHARED_BRIDGE: bridgeFlag } : {}) });
  noExtensions(f);
});
for (const name of ['claude', 'codex']) test(`run-cli ${name} scans safely and its normal Pi SDK child retains user extensions`, t => {
  const f = fixture(t);
  run(f, [path.join(ROOT, 'bin/cli.mjs'), 'run-cli', name, 'sentinel-provider']);
  synchronized(f);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.childReceipt)), { bridge: null, internal: null }, 'worker-only flags must not contaminate provider children');
  const rows = fs.readFileSync(f.events, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(rows.length >= 6);
  assert.ok(rows.every(row => row.caller === 'provider'), 'only the normal provider may import these extensions');
  for (const source of ['global', 'package', 'project']) for (const event of ['import', 'activate']) assert.ok(rows.some(row => row.source === source && row.event === event));
});
test('watcher initial scan and resource refresh do not import extensions', async t => {
  const f = fixture(t);
  const code = `import {watchSources} from ${JSON.stringify(path.join(ROOT, 'src/watch.mjs'))};await watchSources(${JSON.stringify({ home: f.home, data: f.data, state: f.state })},undefined,{intervalMs:50});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { cwd: f.workspace, env: { ...f.env, PI_SHARED_INTERNAL: '1' }, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', data => { stderr += data; });
  async function until(check) { const end = Date.now() + 15000; while (Date.now() < end) { if (check()) return; if (child.exitCode !== null) assert.fail(stderr || 'watcher exited'); await new Promise(resolve => setTimeout(resolve, 50)); } assert.fail('watcher did not synchronize: ' + stderr); }
  try {
    await until(() => fs.existsSync(path.join(f.state, 'last-sync.json')));
    synchronized(f); noExtensions(f);
    f.write(path.join(f.data, 'skills/refresh-probe/SKILL.md'), '---\nname: refresh-probe\ndescription: refresh\n---\nREFRESHED\n');
    await until(() => fs.existsSync(path.join(f.home, '.claude/skills/refresh-probe/SKILL.md')));
    noExtensions(f);
  } finally {
    if (child.exitCode === null && child.signalCode === null) await new Promise(resolve => { const timer = setTimeout(() => child.kill('SIGKILL'), 2000); child.once('exit', () => { clearTimeout(timer); resolve(); }); child.kill('SIGTERM'); });
  }
});
test('explicit bridge runtime loads only its MCP adapter without mutating caller flags', t => {
  const f = fixture(t);
  const code = `import assert from 'node:assert/strict';import {createRuntime} from ${JSON.stringify(path.join(ROOT, 'src/pi.mjs'))};const flags=()=>({bridge:process.env.PI_SHARED_BRIDGE??null,internal:process.env.PI_SHARED_INTERNAL??null});const before=flags();const r=await createRuntime(${JSON.stringify(f.workspace)});try{assert.equal(r.loader.getExtensions().errors.length,0);assert.equal(r.loader.getExtensions().extensions.length,1);assert.deepEqual(flags(),before);}finally{r.session.dispose();}`;
  run(f, ['--input-type=module', '-e', code]); noExtensions(f);
});
