import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export default function sharedRuntime(pi: ExtensionAPI) {
  if (process.env.PI_SHARED_BRIDGE === '1') return;
  async function start() {
    if (process.env.PI_SHARED_INTERNAL === '1') return;
    const { installHost } = await import('../src/host.mjs');
    const { locations } = await import('../src/common.mjs');
    const loc = locations();
    await installHost({ auto: true });
    fs.mkdirSync(loc.state, { recursive: true });
    const log = fs.openSync(join(loc.state, 'bootstrap.log'), 'a', 0o600);
    const child = spawn(process.execPath, [join(root, 'bin/cli.mjs'), 'wait-activation'], {
      detached: true, stdio: ['ignore', log, log], env: { ...process.env, PI_SHARED_INTERNAL: '1' }
    });
    child.unref(); fs.closeSync(log);
  }
  // GUI enable/install resolves extensions without necessarily opening a session.
  void start().catch(() => console.error('[pi-shared-runtime] bootstrap failed; check plugin status'));
  pi.registerCommand('shared-runtime', {
    description: 'Install missing Claude/Codex, synchronize Pi capabilities, and report status',
    handler: async (_args, ctx) => {
      const { initialize } = await import('../src/runtime.mjs');
      const result = await initialize();
      pi.sendMessage({ customType: 'shared-runtime', content: JSON.stringify(result, null, 2), display: true });
    }
  });
  pi.on('session_start', async (_event, ctx) => {
    // Install a launch shim for the next service boot; also schedule one initialization
    // for the current Web process when the package becomes active in a live session.
    await start();
    ctx.ui.setStatus('pi-shared-runtime', 'Claude/Codex sharing enabled');
  });
}
