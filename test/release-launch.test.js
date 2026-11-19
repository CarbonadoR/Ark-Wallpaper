import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ark-release-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 await fs.mkdir(path.join(root,'config'));await fs.mkdir(path.join(root,'server'));
 await fs.copyFile('server/config.mjs',path.join(root,'server/config.mjs'));
 await fs.copyFile('config/runtime.example.json',path.join(root,'config/runtime.example.json'));
 await fs.writeFile(path.join(root,'config/resources.release.json'),JSON.stringify({url:'https://resources.example.invalid/'}));
 return root;
}
const prepare=root=>JSON.parse(execFileSync(process.execPath,['scripts/prepare-release-launch.mjs',root],{encoding:'utf8'}));
test('a fresh release starts without game resources and uses its supplied download service',async t=>{
 const root=await fixture(t),result=prepare(root);
 assert.equal(result.port,8791);assert.equal(result.host,'127.0.0.1');
 assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'config/resources.local.json'))),{url:'https://resources.example.invalid/'});
 assert.ok((await fs.stat(path.join(root,'build/empty-resources'))).isDirectory());
});
test('release preparation preserves a user selected resource service',async t=>{
 const root=await fixture(t),local=path.join(root,'config/resources.local.json');
 await fs.writeFile(local,JSON.stringify({url:'https://custom.example.invalid/'}));prepare(root);
 assert.deepEqual(JSON.parse(await fs.readFile(local)),{url:'https://custom.example.invalid/'});
});
