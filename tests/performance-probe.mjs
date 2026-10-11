// Isolated repeatable source-scan benchmark; no host configuration changes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fingerprint } from '../src/watch.mjs';
const home=fs.mkdtempSync(path.join(os.tmpdir(),'pi-scan-bench-'));
const loc={home,data:path.join(home,'agent'),state:path.join(home,'state')};
try {
 fs.mkdirSync(loc.state,{recursive:true});
 const pkg=path.join(loc.data,'plugins/fixture'),ext=path.join(pkg,'extensions');fs.mkdirSync(ext,{recursive:true});
 for(let i=0;i<2000;i++)fs.writeFileSync(path.join(ext,`tool-${i}.ts`),'fixture');
 fs.writeFileSync(path.join(loc.data,'settings.json'),JSON.stringify({packages:[pkg]}));
 fs.writeFileSync(path.join(loc.state,'last-sync.json'),JSON.stringify({plugins:Array.from({length:30},(_,i)=>({path:path.join(ext,`tool-${i}.ts`)}))}));
 const times=[];let stats=0;const original=fs.statSync;fs.statSync=(...a)=>{stats++;return original(...a);};
 for(let i=0;i<15;i++){const start=performance.now();fingerprint(loc);times.push(performance.now()-start);}
 fs.statSync=original;times.sort((a,b)=>a-b);
 console.log(JSON.stringify({files:2000,overlappingSources:32,iterations:15,statCalls:stats,medianMs:times[7],p95Ms:times[14]}));
} finally {fs.rmSync(home,{recursive:true,force:true});}
