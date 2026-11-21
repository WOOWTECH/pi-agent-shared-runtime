import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { locked, saveJSON } from '../src/common.mjs';
const moduleUrl = new URL('../src/common.mjs', import.meta.url).href;
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-lock-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, file: path.join(root, 'lock') };
}
async function until(test, detail) {
  for (let n = 0; n < 500; n++) { if (test()) return; await new Promise(r => setTimeout(r, 10)); }
  throw new Error('Timed out: ' + detail);
}
function contender(t, { root, file }, id, pauseDelete = false) {
  const source = `import fs from 'node:fs';import path from 'node:path';const root=process.argv[1],file=process.argv[2],id=process.argv[3];
    const wait=async name=>{while(!fs.existsSync(path.join(root,name)))await new Promise(r=>setTimeout(r,10));};
    ${pauseDelete ? `const rm=fs.rmSync;let first=true;fs.rmSync=function(f,...args){if(f===file&&first){first=false;fs.writeFileSync(path.join(root,id+'-deleting'),'');while(!fs.existsSync(path.join(root,id+'-allow-delete')))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);}return rm.call(this,f,...args)};` : ''}
    const {locked}=await import(${JSON.stringify(moduleUrl)});const result=await locked(file,async()=>{fs.writeFileSync(path.join(root,id+'-active'),'');await wait(id+'-finish');return 'held'});fs.writeFileSync(path.join(root,id+'-result'),JSON.stringify(result));`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', source, root, file, id], { stdio: 'ignore' });
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); } });
  return child;
}
test('two stale-lock contenders cannot delete a newly acquired owner or enter together', async t => {
  const f = fixture(t);
  fs.mkdirSync(f.file); fs.writeFileSync(path.join(f.file, 'owner.json'), JSON.stringify({ pid: 2147483647 }));
  const a = contender(t, f, 'a', true);
  await until(() => fs.existsSync(path.join(f.root, 'a-deleting')), 'first stale recovery paused before delete');
  contender(t, f, 'b', true);
  await until(() => fs.existsSync(path.join(f.root, 'b-result')), 'second contender returns busy before delete');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'b-result'))), { busy: true });
  assert.equal(fs.existsSync(path.join(f.root, 'b-deleting')), false);
  fs.writeFileSync(path.join(f.root, 'a-allow-delete'), '');
  await until(() => fs.existsSync(path.join(f.root, 'a-active')), 'first action entered');
  const owner = fs.readFileSync(path.join(f.file, 'owner.json'), 'utf8');
  assert.deepEqual(await locked(f.file, () => assert.fail('active owner must exclude caller')), { busy: true });
  assert.equal(fs.readFileSync(path.join(f.file, 'owner.json'), 'utf8'), owner);
  fs.writeFileSync(path.join(f.root, 'a-finish'), ''); await once(a, 'exit');
  assert.equal(await locked(f.file, () => 'after'), 'after');
});
test('SIGKILL releases OS arbitration and stale owner recovery has no persistent guard', async t => {
  const f = fixture(t), a = contender(t, f, 'crashed');
  await until(() => fs.existsSync(path.join(f.root, 'crashed-active')), 'owner active');
  assert.deepEqual(await locked(f.file, () => assert.fail('must wait for live owner')), { busy: true });
  a.kill('SIGKILL'); await once(a, 'exit');
  assert.equal(await locked(f.file, () => 'recovered'), 'recovered');
  assert.equal(fs.existsSync(f.file), false);
  assert.equal(fs.statSync(f.file + '.sqlite').mode & 0o777, 0o600);
});
test('legacy active owner is retained and SQLite orphan ignores reused PID after crash', async t => {
  const f = fixture(t); fs.mkdirSync(f.file);
  fs.writeFileSync(path.join(f.file, 'owner.json'), JSON.stringify({ pid: process.pid }));
  assert.deepEqual(await locked(f.file, () => assert.fail('legacy active owner')), { busy: true });
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.file, 'owner.json'))).pid, process.pid);
  fs.writeFileSync(path.join(f.file, 'owner.json'), JSON.stringify({ protocol: 'sqlite-v1', pid: process.pid, token: 'stale' }));
  assert.equal(await locked(f.file, () => 'recovered'), 'recovered');
});
test('action failure releases connection and unsafe lock database fails closed', async t => {
  const f = fixture(t);
  await assert.rejects(locked(f.file, () => { throw new Error('expected'); }), /expected/);
  assert.equal(await locked(f.file, () => 'retry'), 'retry');
  const outside = path.join(f.root, 'outside');fs.writeFileSync(outside, 'unchanged');
  fs.unlinkSync(f.file + '.sqlite');fs.symlinkSync(outside, f.file + '.sqlite');
  await assert.rejects(locked(f.file, () => assert.fail('unsafe database')));
  assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
});

test('same-process contention does not drop the active OS lock for another process', async t => {
  const f = fixture(t); let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const held = locked(f.file, async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  await ready;
  try {
    assert.deepEqual(await locked(f.file, () => assert.fail('same process entered twice')), { busy: true });
    contender(t, f, 'external');
    await until(() => fs.existsSync(path.join(f.root, 'external-result')), 'external contender must remain excluded');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root, 'external-result'))), { busy: true });
    assert.equal(fs.existsSync(path.join(f.root, 'external-active')), false);
  } finally { release(); await held; }
});

test('legacy persistent lock recovers a replaced Linux process identity', { skip: process.platform !== 'linux' }, async t => {
  const f = fixture(t);fs.mkdirSync(f.file);
  saveJSON(path.join(f.file, 'owner.json'), { pid: process.pid, startTime: 'replaced-process' });
  assert.equal(await locked(f.file, async () => {
    assert.deepEqual(await locked(f.file, () => 'unexpected'), { busy: true });
    return 'recovered';
  }), 'recovered');
  assert.equal(fs.existsSync(f.file), false);
});
