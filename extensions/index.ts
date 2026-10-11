import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export default function sharedRuntime(pi: ExtensionAPI) {
  if (process.env.PI_SHARED_BRIDGE === '1') return;
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
    const { installHost } = await import('../src/host.mjs');
    await installHost({ auto: true });
    const child = spawn(process.execPath, [join(root, 'bin/cli.mjs'), 'boot', '--current'], {
      detached: true, stdio: 'ignore', env: { ...process.env, PI_SHARED_PACKAGE_ROOT: root }
    });
    child.unref();
    ctx.ui.setStatus('pi-shared-runtime', 'Claude/Codex sharing enabled');
  });
}
