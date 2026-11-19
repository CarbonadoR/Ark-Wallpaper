import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportResourcePack } from '../scripts/ios-resource-pack.mjs';
function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ios-pack-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=','base64');
 const imagePath=path.join(root,'art #$0.png');fs.writeFileSync(imagePath,png);
 return {root,index:{models:[{id:'0123456789abcdef',kind:'StaticE1',mediaType:'image',imagePath,label:'Test',groupId:'char_test',outfit:'E1'}],groups:[{id:'char_test',name:'Test'}]},backgrounds:[],modelIds:['0123456789abcdef'],backgroundIds:[],outputDirectory:path.join(root,'pack')};
}
test('exports only selected resources with safe paths, hashes and stable IDs',t=>{const f=fixture(t);const m=exportResourcePack(f);assert.equal(m.models.length,1);assert.equal(m.models[0].id,f.modelIds[0]);assert.equal(m.files.length,1);assert.match(m.files[0].sha256,/^[a-f0-9]{64}$/);assert.ok(fs.existsSync(path.join(f.outputDirectory,m.models[0].image)));assert.ok(!m.models[0].image.includes('#'));});
test('rejects unknown and duplicate model IDs without publishing',t=>{const f=fixture(t);assert.throws(()=>exportResourcePack({...f,modelIds:['1111111111111111']}),/Unknown/);assert.throws(()=>exportResourcePack({...f,modelIds:[...f.modelIds,...f.modelIds]}),/Duplicate/);assert.ok(!fs.existsSync(f.outputDirectory));});
test('refuses existing destinations and over-budget packs',t=>{const f=fixture(t);assert.throws(()=>exportResourcePack({...f,maxBytes:1}),/budget/);assert.ok(!fs.existsSync(f.outputDirectory));fs.mkdirSync(f.outputDirectory);assert.throws(()=>exportResourcePack(f),/exists/);});
test('rejects unsafe model IDs',t=>{const f=fixture(t);f.index.models[0].id='../escape';f.modelIds=['../escape'];assert.throws(()=>exportResourcePack(f),/Unsafe/);});
test('keeps all atlas pages with deterministic rewritten names',t=>{const f=fixture(t);const a=path.join(f.root,'test.atlas'),s=path.join(f.root,'test');fs.writeFileSync(a,'art #$0.png\nsize: 1,1\nfilter: Linear,Linear\n\nother.png\nsize: 1,1\nfilter: Linear,Linear\n');fs.copyFileSync(f.index.models[0].imagePath,path.join(f.root,'other.png'));fs.writeFileSync(s,'{"skeleton":{"spine":"3.8.99"}}');f.index.models[0]={...f.index.models[0],kind:'DynIllust',mediaType:'spine',atlasPath:a,skeletonPath:s,skeletonFormat:'json',pages:['art #$0.png','other.png'],pageNames:['art #$0.png','other.png'],pageAlphaPaths:[null,null]};const m=exportResourcePack(f);assert.equal(m.models[0].pages.length,2);const atlas=fs.readFileSync(path.join(f.outputDirectory,m.models[0].atlas),'utf8');assert.match(atlas,/page-0.png/);assert.match(atlas,/page-1.png/);assert.equal(m.files.length,4);});
