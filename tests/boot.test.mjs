import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { boot } from '../src/host.mjs';
import { ROOT } from '../src/common.mjs';

test('Pi Web startup initializes silently without creating or prompting a session', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-boot-test-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const data = path.join(home, 'agent'), bin = path.join(home, 'bin');
  fs.mkdirSync(data); fs.mkdirSync(bin);
  for (const name of ['pi-web', 'claude', 'codex']) {
    const script = ['#!/bin/sh', 'case "$1" in', '--version) echo fixture-version ;;',
      'auth|login) echo \'{"loggedIn":true}\' ;;', 'esac', ''].join('\n');
    fs.writeFileSync(path.join(bin, name), script, { mode: 0o755 });
  }
  const old = Object.fromEntries(['HOME', 'PI_SHARED_HOME', 'PI_SHARED_DATA_DIR', 'PI_CODING_AGENT_DIR', 'PATH', 'PI_SHARED_BOOT_ID']
    .map(key => [key, process.env[key]]));
  Object.assign(process.env, { HOME: home, PI_SHARED_HOME: home, PI_SHARED_DATA_DIR: data,
    PI_CODING_AGENT_DIR: data, PATH: bin + path.delimiter + process.env.PATH, PI_SHARED_BOOT_ID: 'quiet-startup-test' });
  t.after(() => { for (const [key, value] of Object.entries(old)) value === undefined ? delete process.env[key] : process.env[key] = value; });
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ packages: [ROOT] }));

  let requests = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => { requests++; return originalFetch(...args); };
  t.after(() => { globalThis.fetch = originalFetch; });
  const loc = { home, data, state: path.join(data, 'shared-runtime') };
  const first = await boot({ current: true, loc });
  const second = await boot({ current: true, loc });
  const initialized = JSON.parse(fs.readFileSync(path.join(data, 'shared-runtime', 'last-initialize.json'), 'utf8'));
  assert.equal(first.status, 'ready', JSON.stringify(initialized));
  assert.equal(second.status, 'ready');
  assert.equal(requests, 0);
  assert.equal(fs.existsSync(path.join(data, 'shared-runtime', 'last-boot.json')), true);
  assert.equal(fs.readdirSync(loc.state).some(name => /^boot-.*\.json$/.test(name)), false);
});
