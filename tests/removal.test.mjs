import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { installHost } from '../src/host.mjs';
import { installProfiles } from '../src/runtime.mjs';
import { ROOT, saveJSON } from '../src/common.mjs';

test('removing package files leaves Pi Web and CLI launchers usable', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-removal-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const loc = { home, data: path.join(home, 'agent'), state: path.join(home, 'agent/state') };
  const real = path.join(home, 'original-launcher');
  fs.writeFileSync(real, '#!/bin/sh\nprintf "ORIGINAL_OK:%s\\n" "$1"\n', { mode: 0o755 });
  saveJSON(path.join(loc.state, 'host.json'), { realWeb: real });
  saveJSON(path.join(loc.state, 'clis.json'), { claude: { binary: real }, codex: { binary: real } });
  await installHost({ loc }); installProfiles(loc);
  const absentCli = path.join(home, 'removed-package/bin/cli.mjs');
  for (const file of [path.join(home, '.local/bin/pi-web'), path.join(home, '.local/pi-shared/bin/claude'), path.join(home, '.local/pi-shared/bin/codex')]) {
    // Simulate only the package path disappearing, leaving the real executables.
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll(path.join(ROOT, 'bin/cli.mjs'), absentCli), { mode: 0o755 });
    const r = spawnSync(process.execPath, [file, '--version'], { encoding: 'utf8' });
    assert.equal(r.status, 0, `${path.basename(file)} must survive package removal`);
    assert.equal(r.stdout.trim(), 'ORIGINAL_OK:--version');
  }
});
