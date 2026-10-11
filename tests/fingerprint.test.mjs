import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fingerprint } from '../src/watch.mjs';
test('overlapping canonical source roots scan once and retain change detection',t=>{
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'pi-fingerprint-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 const data=path.join(home,'agent'),state=path.join(home,'state'),pkg=path.join(data,'plugins/fixture'),ext=path.join(pkg,'extensions');
 fs.mkdirSync(ext,{recursive:true});fs.mkdirSync(state);const file=path.join(ext,'tool.ts');fs.writeFileSync(file,'before');
 fs.writeFileSync(path.join(data,'settings.json'),JSON.stringify({packages:[pkg]}));
 fs.writeFileSync(path.join(state,'last-sync.json'),JSON.stringify({plugins:Array.from({length:30},()=>({path:file}))}));
 let count=0;const original=fs.statSync;fs.statSync=(...args)=>{count++;return original(...args);};
 let before;try{before=fingerprint({home,data,state});}finally{fs.statSync=original;}
 assert.ok(count<15,`unexpected repeated scan: ${count}`);
 fs.writeFileSync(file,'changed source length');assert.notEqual(fingerprint({home,data,state}),before);
 fs.symlinkSync(pkg,path.join(pkg,'loop'),'dir');const cyclic=fingerprint({home,data,state});assert.equal(typeof cyclic,'string');
});
