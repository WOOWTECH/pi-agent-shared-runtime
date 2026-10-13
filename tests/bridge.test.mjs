import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT } from '../src/common.mjs';

test('bridge does not load or expose Pi plugin tools', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shared-bridge-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const data = path.join(home, 'agent'); fs.mkdirSync(data);
  const extension = path.join(home, 'policy.ts'), marker = path.join(home, 'activated');
  fs.writeFileSync(extension, `import fs from 'node:fs';\nexport default function(pi) {\n  fs.writeFileSync(${JSON.stringify(marker)}, 'loaded');\n  pi.registerTool({name:'plugin_only_probe',label:'probe',description:'fixture',parameters:{type:'object',properties:{}},execute:async()=>({content:[{type:'text',text:'plugin'}],details:{}})});\n}`);
  fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ packages: [ROOT], extensions: [extension] }));
  const client = new Client({ name: 'sharing-scope-probe', version: '1' });
  t.after(() => client.close());
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'bin/bridge.mjs')], cwd: home,
    stderr: 'pipe', env: { ...process.env, PI_SHARED_HOME: home, PI_SHARED_DATA_DIR: data, PI_SHARED_BRIDGE: '1' } }));
  const list = await client.listTools();
  assert.equal(list.tools.some(x => x.name === 'plugin_only_probe'), false);
  assert.equal(fs.existsSync(marker), false, 'bridge must not activate unrelated Pi extensions');
  const result = await client.callTool({ name: 'plugin_only_probe', arguments: {} });
  assert.equal(result.isError, true);
});
