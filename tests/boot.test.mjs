import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { ensureConversation } from '../src/host.mjs';
import { digest, saveJSON } from '../src/common.mjs';

test('repeated startup retains one initialization conversation', async t => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-boot-test-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  let creations = 0;
  const server = http.createServer((req,res) => {
    req.resume(); res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/agent/new') { creations++; res.end(JSON.stringify({sessionId:'test-session'})); }
    else res.end('{}');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); t.after(() => server.close());
  const old = process.env.PORT; process.env.PORT = String(server.address().port); t.after(() => { if(old)process.env.PORT=old;else delete process.env.PORT; });
  const loc = { state, home: state };
  const a = await ensureConversation('boot-one',loc); const b = await ensureConversation('boot-one',loc);
  assert.equal(a.sessionId,b.sessionId); assert.equal(creations,1);
});
test('unknown session creation outcome never blindly creates another conversation', async t => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-boot-test-'));
  t.after(() => fs.rmSync(state, { recursive: true, force: true }));
  saveJSON(path.join(state,`boot-${digest('uncertain').slice(0,16)}.json`), { creation:'pending' });
  await assert.rejects(ensureConversation('uncertain',{state,home:state}),/uncertain/);
});
