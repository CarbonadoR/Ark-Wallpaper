import fs from 'node:fs';
import path from 'node:path';
import {PackCache,sourceURL,fetchBytes,atomicJSON,digest,validateDescriptor,validateManifest,safePath} from './resource-delivery.mjs';
import {scanResources,publicCatalog} from './catalog.mjs';
import {scanStaticArt,mergeStaticArt} from './static-art.mjs';
import {scanBackgrounds} from './backgrounds.mjs';
import {clockAssets} from './clock-assets.mjs';

export function validateFeed(feed){
  if(feed?.schemaVersion!==1||!Array.isArray(feed.packs)||feed.packs.length>10000||!Array.isArray(feed.groups)||!Array.isArray(feed.backgrounds))throw Error('Invalid resource feed');
  const ids=new Set();
  for(const p of feed.packs){
    if(!/^[\w-]{1,100}$/.test(p.id)||ids.has(p.id)||!['character','background','clock','support'].includes(p.type))throw Error('Invalid resource pack');
    ids.add(p.id);validateDescriptor(p.desktop);if(p.ios)validateDescriptor(p.ios);
    if(p.modelIDs&&!p.modelIDs.every(id=>/^[a-f0-9]{16}$/.test(id)))throw Error('Invalid model identifiers');
    if(p.backgroundIDs&&!p.backgroundIDs.every(id=>/^[\w-]+$/.test(id)))throw Error('Invalid background identifiers');
  }
  const modelIDs=new Set(feed.packs.flatMap(p=>p.modelIDs||[]));
  for(const g of feed.groups){
    if(typeof g.id!=='string'||!Array.isArray(g.models))throw Error('Invalid resource group');
    for(const m of g.models){
      if(!modelIDs.has(m.id)||!['image','spine'].includes(m.mediaType))throw Error('Invalid catalog model');
      for(const key of ['imageUrl','alphaUrl','atlasUrl','skeletonUrl'])if(m[key]&&!new RegExp(`^/api/models/${m.id}/[a-z.]+(?:\\?v=[a-f0-9]+)?$`).test(m[key]))throw Error('Unsafe catalog URL');
    }
  }
  for(const b of feed.backgrounds)if(!Array.isArray(b.imageUrls)||!b.imageUrls.every(u=>/^\/api\/backgrounds\/[\w-]+\/(image|left|right)(\?delivery=1)?$/.test(u)))throw Error('Unsafe background URL');
  return feed;
}
function scanPack(root){
  const config={resourceRoot:path.join(root,'arts/dynchars'),charpackRoot:path.join(root,'charpack'),skinpackRoot:path.join(root,'skinpack'),characterTableFile:path.join(root,'chartable')};
  const dynamic=fs.existsSync(config.resourceRoot)?scanResources(config.resourceRoot):{models:[],groups:[],issues:[]};
  if(dynamic.issues.length)throw Error('Downloaded resource structure is invalid');
  return {index:mergeStaticArt(dynamic,scanStaticArt(config)),backgrounds:scanBackgrounds(path.join(root,'arts/ui/homebackground/wrapper')),clocks:clockAssets(path.join(root,'arts/ui'))};
}
export function validatePack(root,manifest,pack){
  validateManifest(manifest);
  const listed=new Set(manifest.files.map(f=>f.path));
  // Inspect page names before the existing scanner touches their paths.
  for(const file of manifest.files.filter(f=>f.path.endsWith('.atlas'))){
    for(const line of fs.readFileSync(path.join(root,file.path),'utf8').split(/\r?\n/))if(/\.(?:png|webp|jpe?g)$/i.test(line.trim()))safePath(line.trim());
  }
  const candidate=scanPack(root);
  const dependencies=[];
  for(const m of candidate.index.models){dependencies.push(m.imagePath,m.alphaPath,m.atlasPath,m.skeletonPath,...(m.pages||[]).map(p=>path.join(path.dirname(m.atlasPath),p)),...(m.pageAlphaPaths||[]));for(const a of m.sceneAssets||[])dependencies.push(a.file,a.alphaPath);}
  for(const b of candidate.backgrounds)dependencies.push(b.imagePath,b.leftPath,b.rightPath);
  dependencies.push(...Object.values(candidate.clocks));
  for(const file of dependencies.filter(Boolean)){
    const relative=path.relative(fs.realpathSync(root),fs.realpathSync(file)).split(path.sep).join('/');safePath(relative);
    if(!listed.has(relative))throw Error('Undeclared resource dependency');
  }
  if((pack.modelIDs||[]).some(id=>!candidate.index.models.some(m=>m.id===id))||(pack.backgroundIDs||[]).some(id=>!candidate.backgrounds.some(b=>b.id===id)))throw Error('Downloaded pack is incomplete');
  return candidate;
}
export class ResourceLibrary {
  constructor({root,source,seedFile}){
    this.source=sourceURL(source).href;this.root=path.join(root,digest(this.source).slice(0,16));this.cache=new PackCache({root:this.root,source:this.source,seedFile});
    this.loaded=new Map();this.verified=new Set();this.error=null;this.operation=null;this.progress=null;this.feed=null;
    try{this.feed=validateFeed(JSON.parse(fs.readFileSync(path.join(this.root,'feed.json'),'utf8')));}catch{}
    for(const d of Object.values(this.cache.installed()))try{const root=this.cache.directory(d),manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));this.loaded.set(d.id,{hash:d.sha256,...validatePack(root,manifest,{})});}catch{}
  }
  async refresh({strict=false}={}){
    try{
      const feed=validateFeed(JSON.parse(await fetchBytes(new URL('feed.json',this.source),16*1024**2,AbortSignal.timeout(15000))));
      await atomicJSON(path.join(this.root,'feed.json'),feed);this.feed=feed;this.error=null;return feed;
    }catch(error){this.error='资源目录暂时无法更新，已保留本地缓存。';if(strict||!this.feed)throw error;return this.feed;}
  }
  model(id){for(const p of this.loaded.values()){const model=p.index.models.find(m=>m.id===id||m.legacyIds?.includes(id));if(model)return model;}}
  background(id){for(const p of this.loaded.values()){const b=p.backgrounds.find(b=>b.id===id);if(b)return b;}}
  clock(id){for(const p of this.loaded.values())if(p.clocks[id])return p.clocks[id];}
  async ensureModel(id){const canonical=this.feed?.groups.flatMap(g=>g.models).find(m=>m.id===id||m.legacyIds?.includes(id))?.id||id;const p=this.feed?.packs.find(p=>p.modelIDs?.includes(canonical));if(p)await this.ensure(p);}
  async ensureBackground(id){const p=this.feed?.packs.find(p=>p.backgroundIDs?.includes(id));if(p)await this.ensure(p);}
  async ensureClock(){const p=this.feed?.packs.find(p=>p.type==='clock');if(p)await this.ensure(p);}
  async ensure(pack,signal,verify=false){
    const d=pack.desktop,key=d.id+':'+d.sha256;if(!verify&&this.loaded.get(d.id)?.hash===d.sha256&&this.verified.has(key))return;
    try{
      const root=await this.cache.install(d,{signal,onProgress:p=>{this.progress={...this.progress,name:pack.name,...p};},validate:stage=>{
        validatePack(stage,JSON.parse(fs.readFileSync(path.join(stage,'manifest.json'),'utf8')),pack);
      }});
      this.loaded.set(d.id,{hash:d.sha256,...scanPack(root)});
      this.verified.add(key);
    }catch(error){this.error='资源下载失败，已有缓存仍可使用。';throw error;}
  }
  catalog(local){
    const groups=new Map();
    const append=(g,available)=>{
      const current=groups.get(g.id)||{...g,models:[]},models=new Map(current.models.map(m=>[m.id,m]));
      for(const m of g.models)models.set(m.id,{...m,cached:available||Boolean(this.model(m.id))});
      groups.set(g.id,{...current,...g,models:[...models.values()]});
    };
    for(const g of this.feed?.groups||[])append(g,false);
    for(const g of local.groups)append(g,true);
    for(const pack of this.loaded.values())for(const g of publicCatalog(pack.index).groups)append(g,true);
    const all=[...groups.values()];return {...local,groups:all,stats:{...local.stats,groups:all.length,models:all.reduce((n,g)=>n+g.models.length,0)}};
  }
  backgrounds(local){return [...new Map([...(this.feed?.backgrounds||[]),...local].map(b=>[b.id,b])).values()];}
  status(){const installed=this.cache.installed();return {source:this.source,release:this.feed?.release||null,packs:this.feed?.packs.length||0,cachedPacks:Object.keys(installed).length,totalBytes:this.feed?.totals?.desktopBytes ?? (this.feed?.packs||[]).reduce((n,p)=>n+p.desktop.totalBytes,0),busy:Boolean(this.operation),progress:this.progress,error:this.error};}
  start(mode){
    if(this.operation)throw Error('已有下载任务');if(!this.feed)throw Error('请先检查资源目录');
    const controller=new AbortController();this.operation=controller;this.error=null;
    const packs=this.feed.packs.filter(p=>mode==='all'||this.cache.installed()[p.desktop.id]);
    this.progress={completedPacks:0,totalPacks:packs.length,receivedBytes:0,expectedBytes:0};
    this.batch=(async()=>{try{for(let i=0;i<packs.length;i++){controller.signal.throwIfAborted();await this.ensure(packs[i],controller.signal,true);this.progress={...this.progress,completedPacks:i+1,totalPacks:packs.length};}}catch(e){this.error=controller.signal.aborted?'已取消下载，完成的资源已缓存。':'下载未完成，请检查连接后重试。';}finally{this.operation=null;}})();
  }
  cancel(){this.operation?.abort();}
}
