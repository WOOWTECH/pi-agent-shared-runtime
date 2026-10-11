import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { health } from '../src/health.mjs';
import { ROOT, saveJSON } from '../src/common.mjs';

test('deployment health detects dead controller, partial sync and invalid config without modifying files', t => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pi-health-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const loc={home,data:path.join(home,'agent'),state:path.join(home,'state')};
  saveJSON(path.join(loc.data,'settings.json'),{packages:[ROOT]});
  saveJSON(path.join(loc.state,'last-initialize.json'),{date:'fixture',cli:Object.fromEntries(['claude','codex'].map(n=>[n,{status:'available',binary:process.execPath}]))});
  saveJSON(path.join(loc.state,'last-sync.json'),{date:'fixture',conflicts:[]});
  saveJSON(path.join(loc.state,'watch-state.json'),{status:'active'});
  saveJSON(path.join(loc.state,'watch.lock/owner.json'),{pid:process.pid});
  const before=fs.statSync(path.join(loc.state,'last-sync.json')).mtimeMs;
  assert.equal(health(loc).healthy,true);
  assert.equal(fs.statSync(path.join(loc.state,'last-sync.json')).mtimeMs,before);
  saveJSON(path.join(loc.state,'watch.lock/owner.json'),{pid:process.pid,startTime:'replaced'});
  assert.ok(health(loc).issues.includes('watch-process-unavailable'));
  saveJSON(path.join(loc.state,'last-sync.json'),{date:'fixture',conflicts:[{}],extensionErrors:[{}]});
  assert.ok(health(loc).issues.includes('extension-errors'));
  fs.writeFileSync(path.join(loc.data,'settings.json'),'{');
  assert.deepEqual(health(loc).issues,['configuration-unreadable']);
});
