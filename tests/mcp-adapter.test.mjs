import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT } from '../src/common.mjs';

test('patched global MCP adapter performs a real stdio tool call through the Pi bridge', async t => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'pi-adapter-acceptance-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const data=path.join(home,'agent');fs.mkdirSync(data);
  fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify({packages:[ROOT]}));
  const fixture=path.join(home,'server.mjs');
  fs.writeFileSync(fixture,`
import { Server } from ${JSON.stringify(path.join(ROOT,'node_modules/@modelcontextprotocol/sdk/dist/esm/server/index.js'))};
import { StdioServerTransport } from ${JSON.stringify(path.join(ROOT,'node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js'))};
import { ListToolsRequestSchema,CallToolRequestSchema } from ${JSON.stringify(path.join(ROOT,'node_modules/@modelcontextprotocol/sdk/dist/esm/types.js'))};
const s=new Server({name:'commercial-fixture',version:'1'},{capabilities:{tools:{}}});
s.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'readonly_echo',description:'echo fixture',inputSchema:{type:'object',properties:{marker:{type:'string'}},required:['marker']}}]}));
s.setRequestHandler(CallToolRequestSchema,async r=>({content:[{type:'text',text:'ADAPTER_OK:'+r.params.arguments.marker}]}));
await s.connect(new StdioServerTransport());
`);
  fs.writeFileSync(path.join(data,'mcp.json'),JSON.stringify({mcpServers:{commercial_fixture:{command:process.execPath,args:[fixture]}}}));
  const client=new Client({name:'adapter-acceptance',version:'1'});t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROOT,'bin/bridge.mjs')],cwd:home,stderr:'pipe',
    env:{...process.env,PI_SHARED_HOME:home,PI_SHARED_DATA_DIR:data,PI_SHARED_INTERNAL:'1'}}));
  const list=await client.listTools();assert.ok(list.tools.some(t=>t.name==='pi_global_mcp'));
  const connected=await client.callTool({name:'pi_global_mcp',arguments:{connect:'commercial_fixture'}});
  assert.equal(connected.isError,false,JSON.stringify(connected));
  const result=await client.callTool({name:'pi_global_mcp',arguments:{tool:'commercial_fixture_readonly_echo',args:{marker:'COMMERCIAL'}}});
  assert.equal(result.isError,false,JSON.stringify(result));
  assert.ok(result.content.some(c=>c.text?.includes('ADAPTER_OK:COMMERCIAL')),JSON.stringify(result));
});
