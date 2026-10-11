import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { locked, saveJSON } from '../src/common.mjs';

test('persistent lock recovers when a live PID belongs to a replacement process', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-lock-restart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const lock = path.join(dir, 'boot.lock');
  fs.mkdirSync(lock);
  saveJSON(path.join(lock, 'owner.json'), { pid: process.pid, startTime: 'replaced-process' });
  assert.equal(await locked(lock, async () => {
    assert.deepEqual(await locked(lock, async () => 'unexpected'), { busy: true });
    return 'recovered';
  }), 'recovered');
  assert.equal(fs.existsSync(lock), false);
});
