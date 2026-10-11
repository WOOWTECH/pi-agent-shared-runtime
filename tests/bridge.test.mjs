import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT } from '../src/common.mjs';
test('external MCP retains validation, blocking hooks and result hooks', async t => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-shared-bridge-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const data = path.join(home, 'agent'); fs.mkdirSync(data);
  const extension = path.join(home, 'policy.ts'), marker = path.join(home, 'executed');
  fs.writeFileSync(extension, `import fs from 'node:fs';
export default function(pi) {
  for(const name of ['probe_allowed','probe_blocked'])pi.registerTool({name,label:name,description:'fixture',
    parameters:{type:'object',properties:{value:{type:'string'}},required:['value']},
    execute:async()=>{fs.writeFileSync(${JSON.stringify(marker)},'executed');return {content:[{type:'text',text:'native-result'}],details:{}};}});
  pi.on('tool_call',async e=>e.toolName==='probe_blocked'?{block:true,reason:'fixture-denied'}:undefined);
  pi.on('tool_result',async e=>e.toolName==='probe_allowed'?{content:[{type:'text',text:'hook-transformed'}]}:undefined);
}`);
  fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify({packages:[ROOT],extensions:[extension]}));
  const client = new Client({name:'policy-probe',version:'1'});
  t.after(()=>client.close());
  await client.connect(new StdioClientTransport({command:process.execPath,args:[path.join(ROOT,'bin/bridge.mjs')],cwd:home,
    stderr:'pipe',env:{...process.env,PI_SHARED_HOME:home,PI_SHARED_DATA_DIR:data,PI_SHARED_BRIDGE:'1'}}));
  const list=await client.listTools();assert.ok(list.tools.some(x=>x.name==='probe_allowed'));
  const blocked=await client.callTool({name:'probe_blocked',arguments:{value:'test'}});
  assert.equal(blocked.isError,true);assert.ok(blocked.content[0].text.includes('fixture-denied'));
  assert.equal(fs.existsSync(marker),false);
  const invalid=await client.callTool({name:'probe_allowed',arguments:{}});
  assert.equal(invalid.isError,true);assert.equal(fs.existsSync(marker),false);
  const allowed=await client.callTool({name:'probe_allowed',arguments:{value:'test'}});
  assert.equal(allowed.isError,false);assert.equal(allowed.content[0].text,'hook-transformed');
  assert.equal(fs.readFileSync(marker,'utf8'),'executed');
});
