#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { locations, readJSON, ROOT, enabled, safeError, commandPath, locked } from '../src/common.mjs';
import { installHost, launchWeb, boot } from '../src/host.mjs';
import { initialize, latest } from '../src/runtime.mjs';
import { synchronize } from '../src/sync.mjs';

const [action = 'status', ...args] = process.argv.slice(2), loc = locations();
// Resource scans in the worker must not start another bootstrap worker.
process.env.PI_SHARED_INTERNAL = '1';
try {
  if (action === 'launch-web') await launchWeb(args, loc);
  else if (action === 'install-host') {
    console.log(JSON.stringify(await installHost({ auto: args.includes('--auto'), loc })));
    if (args.includes('--auto')) {
      fs.mkdirSync(loc.state, { recursive: true });
      const log = fs.openSync(path.join(loc.state, 'bootstrap.log'), 'a', 0o600);
      const child = spawn(process.execPath, [path.join(ROOT, 'bin/cli.mjs'), 'wait-activation'],
        { detached: true, stdio: ['ignore', log, log], env: process.env });
      child.unref(); fs.closeSync(log);
    }
  } else if (action === 'wait-activation') {
    // Pi persists its package entry after npm postinstall returns.
    for (let attempt = 0; attempt < 120; attempt++) {
      if (enabled(loc)) { console.log(JSON.stringify(await boot({ current: true, watch: true, loc }))); break; }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } else if (action === 'boot') {
    console.log(JSON.stringify(await boot({ current: args.includes('--current'), watch: !args.includes('--once'), loc })));
  } else if (action === 'initialize') console.log(JSON.stringify(await initialize(loc), null, 2));
  else if (action === 'sync') console.log(JSON.stringify(await locked(path.join(loc.state, 'initialize.lock'), () => synchronize({ cwd: args.includes('--global') ? loc.home : process.cwd(), loc })), null, 2));
  else if (action === 'status') console.log(JSON.stringify(latest(loc), null, 2));
  else if (action === 'run-cli') {
    const [name, ...cliArgs] = args;
    if (!['codex', 'claude'].includes(name)) throw new Error('Expected claude or codex');
    if (enabled(loc) && !['--version', '--help'].some(a => cliArgs.includes(a))) {
      try { await locked(path.join(loc.state, 'initialize.lock'), () => synchronize({ cwd: process.cwd(), loc })); }
      catch (e) { console.error('[pi-shared-runtime] sync failed:', JSON.stringify(safeError(e))); }
    }
    const cli = readJSON(path.join(loc.state, 'clis.json'))[name];
    const binary = cli?.binary || commandPath(name, process.env, [path.join(loc.home, '.local/pi-shared/bin')]);
    if (!binary) throw new Error('CLI missing; run initialize');
    const child = spawn(binary, cliArgs, { stdio: 'inherit' });
    child.once('error', e => { console.error(safeError(e)); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => child.kill(signal));
    child.once('exit', c => process.exit(c ?? 1));
  } else throw new Error('Use install-host, launch-web, boot, initialize, sync, status, or run-cli');
} catch (e) { console.error('[pi-shared-runtime]', JSON.stringify(safeError(e))); process.exitCode = 1; }
