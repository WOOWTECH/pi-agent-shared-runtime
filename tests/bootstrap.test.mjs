import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { ROOT } from '../src/common.mjs';

async function until(check, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (check()) return; await new Promise(r => setTimeout(r, 100)); }
  assert.fail('bootstrap condition timed out');
}
test('GUI resource activation initializes silently and reactivation syncs without creating sessions', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-gui-bootstrap-'));
  const data = path.join(home, 'agent'), state = path.join(data, 'shared-runtime'), bin = path.join(home, 'bin');
  fs.mkdirSync(data); fs.mkdirSync(bin);
  const workers = new Set();
  t.after(() => { for (const pid of workers) { try { process.kill(pid, 'SIGTERM'); } catch {} } });
  for (const name of ['pi-web', 'codex', 'claude']) {
    fs.writeFileSync(path.join(bin, name), name === 'claude'
      ? '#!/bin/sh\nif [ "$1" = auth ]; then echo \'{"loggedIn":true}\'; else echo fixture-claude; fi\n'
      : '#!/bin/sh\necho fixture-version\n', { mode: 0o755 });
  }
  let conversations = 0;
  const server = http.createServer((req, res) => {
    req.resume(); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/agent/new') { conversations++; res.end('{"sessionId":"fixture-conversation"}'); }
    else res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const env = { ...process.env, HOME: home, PI_SHARED_HOME: home, PI_SHARED_DATA_DIR: data,
    PI_CODING_AGENT_DIR: data, PI_SHARED_BOOT_ID: 'gui-fixture-boot',
    PORT: String(server.address().port), PATH: bin + ':' + process.env.PATH };
  delete env.PI_SHARED_INTERNAL; delete env.PI_SHARED_BRIDGE;
  const activate = () => new Promise((resolve, reject) => {
    const code = `import {loadResources} from ${JSON.stringify(path.join(ROOT, 'src/pi.mjs'))}; await loadResources(${JSON.stringify(home)});`;
    const child = spawn(process.execPath, ['--input-type=module', '-e', code], { env, stdio: 'ignore' });
    child.on('error', reject); child.on('exit', c => c === 0 ? resolve() : reject(new Error('activation failed')));
  });
  const settings = path.join(data, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ packages: [ROOT] }));
  await activate();
  await until(() => fs.existsSync(path.join(state, 'last-initialize.json')));
  await until(() => fs.existsSync(path.join(state, 'watch.lock/owner.json')));
  workers.add(JSON.parse(fs.readFileSync(path.join(state, 'watch.lock/owner.json'))).pid);
  assert.equal(conversations, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(state, 'last-initialize.json'))).status, 'ready');
  fs.writeFileSync(settings, '{"packages":[]}');
  const skillDir = path.join(data, 'skills/reactivation-probe'); fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: reactivation-probe\ndescription: fixture\n---\nNEW_SOURCE\n');
  assert.equal(fs.existsSync(path.join(home, '.claude/skills/reactivation-probe')), false);
  fs.writeFileSync(settings, JSON.stringify({ packages: [ROOT] }));
  await activate();
  await until(() => fs.existsSync(path.join(home, '.claude/skills/reactivation-probe/SKILL.md')));
  assert.equal(conversations, 0);
  assert.equal(fs.readFileSync(path.join(home, '.claude/skills/reactivation-probe/SKILL.md'), 'utf8').includes('NEW_SOURCE'), true);
  // Child shutdown is asynchronous; leave fixture cleanup to OS temp management.
});
