import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { ROOT } from '../src/common.mjs';

test('GUI settings-only disable pauses work and enable resumes sync without resource reload', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-watch-reactivate-'));
  const data = path.join(home, 'agent'), state = path.join(data, 'shared-runtime');
  fs.mkdirSync(data);
  const settings = path.join(data, 'settings.json');
  fs.writeFileSync(settings, '{"packages":[]}');
  const env = { ...process.env, HOME: home, PI_SHARED_HOME: home, PI_SHARED_DATA_DIR: data, PI_SHARED_INTERNAL: '1' };
  const child = spawn(process.execPath, ['--input-type=module', '-e',
    `import {watchSources} from ${JSON.stringify(path.join(ROOT, 'src/watch.mjs'))}; await watchSources(${JSON.stringify({ home, data, state })}, undefined, {intervalMs:50});`], { env, stdio: 'ignore' });
  t.after(() => child.kill('SIGTERM'));
  async function until(check) { const end=Date.now()+10000; while(Date.now()<end) { if(check())return;await new Promise(r=>setTimeout(r,50)); } assert.fail('watch state timed out'); }
  const status = () => { try { return JSON.parse(fs.readFileSync(path.join(state, 'watch-state.json'))).status; } catch {} };
  await until(() => status() === 'paused');
  const skill = path.join(data, 'skills/settings-only-probe'); fs.mkdirSync(skill,{recursive:true});
  fs.writeFileSync(path.join(skill,'SKILL.md'),'---\nname: settings-only-probe\ndescription: fixture\n---\nGUI_ONLY\n');
  await new Promise(r=>setTimeout(r,150));
  const target=path.join(home,'.claude/skills/settings-only-probe/SKILL.md');
  assert.equal(fs.existsSync(target),false);
  // No reload, session event, CLI invocation, or install action here.
  fs.writeFileSync(settings,JSON.stringify({packages:[ROOT]}));
  await until(()=>fs.existsSync(target));
  assert.equal(status(),'active');
  fs.writeFileSync(settings,'{"packages":[]}'); await until(()=>status()==='paused');
  const report=path.join(state,'last-sync.json'), before=fs.readFileSync(report,'utf8');
  fs.writeFileSync(path.join(skill,'SKILL.md'),'changed while disabled');
  await new Promise(r=>setTimeout(r,200)); assert.equal(fs.readFileSync(report,'utf8'),before);
});
