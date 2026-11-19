import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pageAlphaMode } from '../server/catalog.mjs';
import { renderTexturePng } from '../server/png-alpha.mjs';

export function exportResourcePack({index, backgrounds, modelIds, backgroundIds, outputDirectory, maxBytes=80*1024*1024}) {
 if(fs.existsSync(outputDirectory)) throw Error('Output already exists');
 for(const ids of [modelIds,backgroundIds]) if(new Set(ids).size!==ids.length) throw Error('Duplicate IDs');
 const chosen=modelIds.map(id=>{if(!/^[a-f0-9]{16}$/.test(id))throw Error('Unsafe model ID');const m=index.models.find(m=>m.id===id);if(!m)throw Error('Unknown model ID');if(!m.kind.startsWith('Static')&&m.kind!=='DynIllust')throw Error('Unsupported model kind');return m;});
 const bgs=backgroundIds.map(id=>{if(!/^[\w-]+$/.test(id))throw Error('Unsafe background ID');const b=backgrounds.find(b=>b.id===id);if(!b)throw Error('Unknown background ID');return b;});
 const stage=outputDirectory+'.tmp-'+crypto.randomUUID(), manifest={schemaVersion:1,packID:'local-samples',version:1,models:[],backgrounds:[],files:[]};let total=0;
 const put=(relative,data)=>{total+=data.length;if(total>maxBytes)throw Error('Resource pack exceeds byte budget');const f=path.join(stage,relative);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data);manifest.files.push({path:relative,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex')});};
 try {
 fs.mkdirSync(stage,{recursive:true});
 for(const m of chosen){const prefix=`models/${m.id}/`,entry={id:m.id,name:index.groups.find(g=>g.id===m.groupId)?.name||m.groupId,outfit:m.outfit||m.label,kind:m.kind,mediaType:m.mediaType||'spine'};
 if(m.mediaType==='image'){entry.image=prefix+'image.png';put(entry.image,renderTexturePng(m.imagePath,{alphaPath:m.alphaPath,alphaMode:'straight',resizeStaticAlpha:true})||fs.readFileSync(m.imagePath));}
 else {entry.atlas=prefix+'model.atlas';entry.skeleton=prefix+(m.skeletonFormat==='binary'?'model.skel':'model.json');entry.skeletonFormat=m.skeletonFormat;entry.pages=[];
 const names=new Map();for(let i=0;i<m.pages.length;i++){const mode=m.pageAlphaPaths?.[i]?'straight':pageAlphaMode(m,i),p=path.join(path.dirname(m.atlasPath),m.pages[i]);const name=`page-${i}.png`;names.set((m.pageNames||m.pages)[i],name);entry.pages.push({path:prefix+name,alphaMode:mode});put(prefix+name,renderTexturePng(p,{alphaPath:m.pageAlphaPaths?.[i],alphaMode:mode,atlasPath:m.atlasPath,pageName:(m.pageNames||m.pages)[i]})||fs.readFileSync(p));}
 put(entry.atlas,Buffer.from(fs.readFileSync(m.atlasPath,'utf8').split(/\r?\n/).map(l=>names.get(l.trim())||l).join('\n')));put(entry.skeleton,fs.readFileSync(m.skeletonPath));}
 manifest.models.push(entry);
 }
 for(const b of bgs){const images=[b.leftPath,b.rightPath].map((p,i)=>{const name=`backgrounds/${b.id}/${i}.png`;put(name,fs.readFileSync(p));return name;});manifest.backgrounds.push({id:b.id,name:b.name,images});}
 manifest.totalBytes=total;fs.writeFileSync(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2));fs.renameSync(stage,outputDirectory);return manifest;
 } catch(e){fs.rmSync(stage,{recursive:true,force:true});throw e;}
}
