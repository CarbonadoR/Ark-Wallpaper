import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {scanResources,publicCatalog} from '../server/catalog.mjs';
import {scanStaticArt,mergeStaticArt,loadCharacters} from '../server/static-art.mjs';
import {scanBackgrounds,publicBackgrounds} from '../server/backgrounds.mjs';
import {clockAssets} from '../server/clock-assets.mjs';
import {exportResourcePack} from './ios-resource-pack.mjs';
import {Publication} from './resource-publication.mjs';

const {values}=parseArgs({options:{root:{type:'string'},output:{type:'string'},'desktop-only':{type:'boolean',default:false}}});
if(!values.root||!values.output)throw Error('Usage: node scripts/publish-resources.mjs --root PRUNED_ROOT --output OUTPUT [--desktop-only]');
const root=fs.realpathSync(values.root),output=path.resolve(values.output);
const config={resourceRoot:path.join(root,'arts/dynchars'),charpackRoot:path.join(root,'charpack'),skinpackRoot:path.join(root,'skinpack'),characterTableFile:path.join(root,'chartable'),backgroundRoot:path.join(root,'arts/ui/homebackground/wrapper'),uiRoot:path.join(root,'arts/ui')};
const dynamic=scanResources(config.resourceRoot),index=mergeStaticArt(dynamic,scanStaticArt(config)),backgrounds=scanBackgrounds(config.backgroundRoot),clocks=clockAssets(config.uiRoot);
if(dynamic.issues.length)throw Error('Fix resource structure issues before publishing');
const pub=new Publication(output),raw=new Map(),used=new Set();
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);}
// The publisher never walks arbitrary project files: only the four explicit pruned resource roots.
for(const folder of ['arts','charpack','skinpack','chartable'])for(const file of walk(path.join(root,folder))){
  if(fs.lstatSync(file).isSymbolicLink())throw Error('Resource symlinks are not supported');
  if(/\.local\.(?:json|md)$|\.DS_Store$/i.test(file))continue;
  const relative=path.relative(root,file).split(path.sep).join('/');raw.set(file,await pub.add(relative,file));
}
const characters=loadCharacters(config.characterTableFile);
const desktopPack=async(id,files)=>{
  const unique=[...new Map(files.map(f=>[f.path,f])).values()];unique.forEach(f=>used.add(f.path));
  return pub.pack({schemaVersion:1,packID:id,version:1,files:unique,totalBytes:unique.reduce((s,f)=>s+f.bytes,0)});
};
const feed={schemaVersion:1,release:new Date().toISOString(),groups:publicCatalog(index).groups,backgrounds:publicBackgrounds(backgrounds),packs:[],issues:[]};
for(const group of index.groups){
  const table=await pub.add('chartable/character_table.json',Buffer.from(JSON.stringify({Characters:characters[group.id]?{[group.id]:characters[group.id]}:{}})));
  const files=[table],sources=new Set();
  const add=p=>{if(p){const f=raw.get(path.resolve(p));if(!f)throw Error('Missing pruned dependency');files.push(f);}};
  for(const m of group.models){
    if(m.mediaType==='image'){add(m.imagePath);add(m.alphaPath);}else{
      add(m.atlasPath);add(m.skeletonPath);m.pages.forEach(p=>add(path.join(path.dirname(m.atlasPath),p)));m.pageAlphaPaths?.forEach(add);
      for(const a of m.sceneAssets||[]){add(a.file);add(a.alphaPath);}
      sources.add(path.relative(config.resourceRoot,m.atlasPath).split(path.sep)[0]);
    }
  }
  for(const [file,entry] of raw)if(file.endsWith('.obj')&&sources.has(path.relative(config.resourceRoot,file).split(path.sep)[0]))files.push(entry);
  const desktop=await desktopPack('character-'+group.id,files);
  feed.packs.push({id:group.id,name:group.name,type:'character',modelIDs:group.models.map(m=>m.id),desktop});
}
for(const b of backgrounds){const desktop=await desktopPack('background-'+b.id,[b.imagePath,b.leftPath,b.rightPath].map(p=>raw.get(p)));feed.packs.push({id:b.id,name:b.name,type:'background',backgroundIDs:[b.id],desktop});}
feed.packs.push({id:'clocks',name:'时钟素材',type:'clock',desktop:await desktopPack('clocks',Object.values(clocks).map(p=>raw.get(p)))});
const remainder=[...raw.values()].filter(f=>!used.has(f.path));
if(remainder.length)feed.packs.push({id:'support',name:'配套资源',type:'support',desktop:await desktopPack('support',remainder)});
await pub.finish(feed);console.log(`Desktop published: ${index.models.length} models, ${feed.packs.length} packs, ${raw.size} files`);
if(!values['desktop-only']){
  const temporary=path.join(output,'native-work');fs.mkdirSync(temporary,{recursive:true});
  try{
    for(const pack of feed.packs){
      if(!['character','background'].includes(pack.type))continue;
      const models=[],bgs=[],files=[];
      const ids=pack.type==='character'?index.groups.find(g=>g.id===pack.id).models.filter(m=>m.mediaType==='image'||m.kind==='DynIllust').map(m=>m.id):[null];
      for(const id of ids){const target=path.join(temporary,id||pack.id);
        try{
          const native=exportResourcePack({index,backgrounds,modelIds:id?[id]:[],backgroundIds:id?[]:pack.backgroundIDs,outputDirectory:target,maxBytes:512*1024**2});
          models.push(...native.models);bgs.push(...native.backgrounds);
          for(const f of native.files)files.push(await pub.add(f.path,path.join(target,f.path)));
        }catch(error){feed.issues.push({platform:'ios',modelID:id,backgroundID:id?undefined:pack.id,reason:error.message.replaceAll(root,'<resources>')});}
        finally{fs.rmSync(target,{recursive:true,force:true});}
      }
      if(models.length||bgs.length)pack.ios=await pub.pack({schemaVersion:1,packID:pack.desktop.id,version:1,models,backgrounds:bgs,files,totalBytes:files.reduce((n,f)=>n+f.bytes,0)});
      if(feed.packs.indexOf(pack)%25===0)console.log(`Native packs ${feed.packs.indexOf(pack)+1}/${feed.packs.length}`);
    }
  }finally{fs.rmSync(temporary,{recursive:true,force:true});}
  await pub.finish(feed);console.log(`Native published: ${feed.packs.filter(p=>p.ios).length} packs; excluded items: ${feed.issues.length}`);
}
