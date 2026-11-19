import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { PackCache, validateManifest } from '../server/resource-delivery.mjs';
import { Publication } from '../scripts/resource-publication.mjs';
import { ResourceLibrary,validateFeed,validatePack } from '../server/resource-library.mjs';
import { resourceRoutes } from '../server/resource-routes.mjs';
import express from 'express';

const sha = data => crypto.createHash('sha256').update(data).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'ark-delivery-'));
  const payload = Buffer.from('first artwork');
  const file = { path: 'arts/dynchars/test/image.png', bytes: payload.length, sha256: sha(payload) };
  const manifest = { schemaVersion: 1, packID: 'character-test', version: 1, files: [file], totalBytes: payload.length };
  const routes = new Map(); const requests = [];
  const server = http.createServer((req, res) => { requests.push(req.url); const data = routes.get(req.url); if (!data) {res.writeHead(404).end();return;} res.end(data); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); });
  const source = `http://127.0.0.1:${server.address().port}/`;
  const publish = m => { const data = Buffer.from(JSON.stringify(m)); const descriptor = { id: m.packID, sha256: sha(data), bytes: data.length, totalBytes: m.totalBytes }; routes.set('/manifests/' + descriptor.sha256 + '.json', data); return descriptor; };
  routes.set('/blobs/' + file.sha256, payload);
  return { root, source, routes, requests, manifest, file, publish, cache: new PackCache({ root, source }) };
}
test('downloads one character once, verifies it and survives an offline restart', async t => {
  const f = await fixture(t), d = f.publish(f.manifest);
  const [a, b] = await Promise.all([f.cache.install(d), f.cache.install(d)]);
  assert.equal(a, b); assert.equal(await fs.readFile(path.join(a, f.file.path), 'utf8'), 'first artwork');
  assert.equal(f.requests.filter(x => x.startsWith('/blobs/')).length, 1);
  f.routes.clear();
  const restarted = new PackCache({ root: f.root, source: f.source });
  assert.equal(await restarted.install(d), a);
});
test('corrupt replacement leaves the previously installed character usable', async t => {
  const f = await fixture(t), old = f.publish(f.manifest); const before = await f.cache.install(old);
  const next = { ...f.manifest, files: [{...f.file, sha256:sha('second artwork'),bytes:14}],totalBytes:14 };
  const d = f.publish(next); f.routes.set('/blobs/' + next.files[0].sha256, Buffer.from('broken artwork'));
  await assert.rejects(f.cache.install(d), /integrity/i);
  assert.equal(f.cache.installed()[old.id].sha256, old.sha256);
  assert.equal(await fs.readFile(path.join(before, f.file.path), 'utf8'), 'first artwork');
});
test('new manifests reuse unchanged blobs and replace removed files atomically', async t => {
  const f=await fixture(t); await f.cache.install(f.publish(f.manifest));
  const next={...f.manifest,files:[{...f.file,path:'arts/dynchars/test/new.png'}]};
  const result=await f.cache.install(f.publish(next));
  assert.equal(f.requests.filter(x=>x.startsWith('/blobs/')).length,1);
  assert.equal(await fs.readFile(path.join(result,next.files[0].path),'utf8'),'first artwork');
  await assert.rejects(fs.access(path.join(result,f.file.path)));
});
test('rejects traversal, Windows path aliases, duplicate paths and inconsistent byte totals', () => {
  const valid={schemaVersion:1,packID:'test',version:1,totalBytes:1,files:[{path:'models/a.png',bytes:1,sha256:'a'.repeat(64)}]};
  assert.doesNotThrow(()=>validateManifest(valid));
  for(const path of ['../escape','/tmp/file','a/../b','a\\b','C:/b','a/CON.png','a./b','a//b']) assert.throws(()=>validateManifest({...valid,files:[{...valid.files[0],path}]}));
  assert.throws(()=>validateManifest({...valid,totalBytes:2}));
  assert.throws(()=>validateManifest({...valid,files:[...valid.files,...valid.files],totalBytes:2}));
});
test('publisher shares identical blobs across character packs and commits a portable feed', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ark-publish-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const publication=new Publication(root);
  const file=await publication.add('models/a.png',Buffer.from('artwork'));
  const a=await publication.pack({schemaVersion:1,packID:'one',version:1,files:[file],totalBytes:7});
  const b=await publication.pack({schemaVersion:1,packID:'two',version:1,files:[file],totalBytes:7});
  await publication.finish({schemaVersion:1,packs:[{desktop:a},{desktop:b}],groups:[],backgrounds:[]});
  assert.equal((await fs.readdir(path.join(root,'blobs'))).length,1);
  const data=await fs.readFile(path.join(root,'manifests',a.sha256+'.json'));
  assert.equal(sha(data),a.sha256);
  assert.equal(JSON.parse(await fs.readFile(path.join(root,'feed.json'))).packs.length,2);
  await assert.rejects(publication.add('config/runtime.local.json',Buffer.from('private')));
});

test('desktop keeps uncached catalog entries visible, downloads on demand and retains them offline', async t => {
  const f=await fixture(t);
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=','base64');
  const table=Buffer.from(JSON.stringify({Characters:{char_test:{Name:'Test'}}}));
  const entries=[['charpack/char_test/char_test_1.png',image],['chartable/character_table.json',table]].map(([path,data])=>{const item={path,bytes:data.length,sha256:sha(data)};f.routes.set('/blobs/'+item.sha256,data);return item;});
  const descriptor=f.publish({...f.manifest,files:entries,totalBytes:entries.reduce((n,x)=>n+x.bytes,0)});
  const id=crypto.createHash('sha1').update('static:character:char_test/char_test_1.png').digest('hex').slice(0,16);
  const feed={schemaVersion:1,release:'one',groups:[{id:'char_test',name:'Test',models:[{id,mediaType:'image',kind:'StaticE1',imageUrl:`/api/models/${id}/image.png`}]}],backgrounds:[],packs:[{id:'char_test',name:'Test',type:'character',modelIDs:[id],desktop:descriptor}]};
  f.routes.set('/feed.json',Buffer.from(JSON.stringify(feed)));
  const library=new ResourceLibrary({root:path.join(f.root,'library'),source:f.source});await library.refresh();
  const empty={groups:[],stats:{groups:0,models:0,issues:0}};
  assert.equal(library.catalog(empty).groups[0].models[0].cached,false);
  assert.equal(f.requests.filter(x=>x.startsWith('/blobs/')).length,0);
  await library.ensureModel(id);assert.ok(library.model(id));assert.equal(library.catalog(empty).groups[0].models[0].cached,true);
  f.routes.clear();const restarted=new ResourceLibrary({root:path.join(f.root,'library'),source:f.source});await restarted.refresh();
  assert.ok(restarted.model(id));assert.equal(restarted.catalog(empty).stats.models,1);
});
test('rejects feeds that navigate resource requests to unrelated origins',()=>{
  assert.throws(()=>validateFeed({schemaVersion:1,packs:[],groups:[{id:'g',models:[{id:'0123456789abcdef',mediaType:'image',imageUrl:'https://example.invalid/private'}]}],backgrounds:[]}));
});
test('cancellation never activates an unfinished pack',async t=>{
  const f=await fixture(t),d=f.publish(f.manifest),controller=new AbortController();
  await assert.rejects(f.cache.install(d,{signal:controller.signal,onProgress:()=>controller.abort()}));
  assert.deepEqual(f.cache.installed(),{});
});
test('semantic validation rejects a complete but unusable replacement before activation',async t=>{
  const f=await fixture(t),d=f.publish(f.manifest);
  await assert.rejects(f.cache.install(d,{validate:()=>{throw Error('Invalid skeleton');}}),/skeleton/);
  assert.deepEqual(f.cache.installed(),{});
});
test('repairs corrupt installed payloads and missing manifests without losing the prior generation',async t=>{
  const f=await fixture(t),d=f.publish(f.manifest),old=await f.cache.install(d);
  await fs.writeFile(path.join(old,f.file.path),'corrupt');
  const repaired=await f.cache.install(d);
  assert.equal(await fs.readFile(path.join(repaired,f.file.path),'utf8'),'first artwork');
  await fs.unlink(path.join(repaired,'manifest.json'));
  const recovered=await f.cache.install(d);
  assert.equal(await fs.readFile(path.join(recovered,f.file.path),'utf8'),'first artwork');
  assert.ok(JSON.parse(await fs.readFile(path.join(recovered,'manifest.json'))));
});
test('a failed resource source change preserves the previous settings and catalog',async t=>{
  const f=await fixture(t);f.routes.set('/feed.json',Buffer.from(JSON.stringify({schemaVersion:1,packs:[],groups:[],backgrounds:[]})));
  const endpoint=resourceRoutes({root:f.root}),app=express();app.use('/api',endpoint.router);
  const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});t.after(()=>new Promise(resolve=>server.close(resolve)));
  const put=url=>fetch(`http://127.0.0.1:${server.address().port}/api/resources/settings`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
  assert.equal((await put(f.source)).status,200);
  assert.equal((await put(f.source+'missing/')).status,400);
  assert.equal(JSON.parse(await fs.readFile(path.join(f.root,'config/resources.local.json'))).url,f.source);
  assert.equal(endpoint.library.source,f.source);
});
test('remote atlases cannot resolve texture pages outside their declared package',async t=>{
  const f=await fixture(t),root=path.join(f.root,'stage'),atlas='arts/dynchars/operator/DynIllust/model.atlas';
  await fs.mkdir(path.dirname(path.join(root,atlas)),{recursive:true});
  const content=Buffer.from('../../../../../outside.png\nsize: 1,1\n');await fs.writeFile(path.join(root,atlas),content);
  assert.throws(()=>validatePack(root,{...f.manifest,files:[{path:atlas,bytes:content.length,sha256:sha(content)}],totalBytes:content.length},{}),/Unsafe/);
});
test('reuses existing local resources after hash verification without downloading their blobs',async t=>{
  const f=await fixture(t),seed=path.join(f.root,'existing.png');await fs.writeFile(seed,'first artwork');
  f.routes.delete('/blobs/'+f.file.sha256);
  const cache=new PackCache({root:path.join(f.root,'seeded'),source:f.source,seedFile:()=>seed});
  const directory=await cache.install(f.publish(f.manifest));
  assert.equal(await fs.readFile(path.join(directory,f.file.path),'utf8'),'first artwork');
  assert.equal(f.requests.filter(p=>p.startsWith('/blobs/')).length,0);
});
