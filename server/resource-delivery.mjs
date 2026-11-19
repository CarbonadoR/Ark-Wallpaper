import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9_-]{1,100}$/;
export function safePath(value) {
  if (typeof value !== 'string' || value.length > 1000 || value.includes('\\') || /[\x00-\x1f:]/.test(value)
    || value.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error('Unsafe resource path');
  return value;
}
export function sourceURL(value) {
  const url = new URL(value);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash) throw Error('Resource service requires HTTPS');
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
}
export function validateDescriptor(d) {
  if (!d || !ID.test(d.id) || !HASH.test(d.sha256) || !Number.isSafeInteger(d.bytes) || d.bytes < 1 || d.bytes > 16*1024*1024
    || !Number.isSafeInteger(d.totalBytes) || d.totalBytes < 0 || d.totalBytes > 32*1024**3) throw Error('Invalid pack descriptor');
  return d;
}
export function validateManifest(m) {
  if (!m || m.schemaVersion !== 1 || !ID.test(m.packID) || !Array.isArray(m.files) || m.files.length > 100000) throw Error('Invalid resource manifest');
  const seen = new Set(); let total = 0;
  for (const f of m.files) {
    const key = safePath(f.path).toLowerCase();
    if (seen.has(key) || !HASH.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 0 || f.bytes > 512*1024**2) throw Error('Invalid resource file');
    seen.add(key); total += f.bytes;
  }
  if (total !== m.totalBytes || total > 32*1024**3) throw Error('Invalid resource byte total');
  return m;
}
export async function atomicJSON(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try { await fsp.writeFile(temporary, JSON.stringify(value)); await fsp.rename(temporary, file); }
  finally { await fsp.rm(temporary, { force:true }); }
}
export async function fileHash(file) {
  const hash=crypto.createHash('sha256'); for await(const chunk of fs.createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
async function intact(file, entry) {
  try { const s=await fsp.lstat(file); return s.isFile() && s.size===entry.bytes && await fileHash(file)===entry.sha256; } catch { return false; }
}
export async function fetchBytes(url, limit, signal) {
  const response = await fetch(url, { redirect:'error', signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
  if (!response.ok) throw Error(`Resource request failed (${response.status})`);
  const parts=[]; let length=0;
  try { for await (const chunk of response.body) { length += chunk.length; if(length>limit) throw Error('Resource response exceeds limit'); parts.push(chunk); } }
  finally { if (length>limit) await response.body.cancel().catch(()=>{}); }
  return Buffer.concat(parts);
}

export class PackCache {
  constructor({root,source,seedFile}) { this.root=path.resolve(root); this.source=sourceURL(source); this.seedFile=seedFile; this.pending=new Map(); this.commit=Promise.resolve(); }
  installed() {
    try { const data=JSON.parse(fs.readFileSync(path.join(this.root,'installed.json'),'utf8')); return Object.fromEntries(Object.entries(data).filter(([id,d])=>ID.test(id)&&d?.id===id&&HASH.test(d.sha256))); }
    catch {return {};}
  }
  directory(d) {
    validateDescriptor(d);const installed=this.installed()[d.id];
    const generation=d.generation||(installed?.sha256===d.sha256?installed.generation:null);
    if(generation&&!/^[a-f0-9]{64}-[a-f0-9]{32}$/.test(generation))throw Error('Invalid cache generation');
    return path.join(this.root,'packs',d.id,generation||d.sha256);
  }
  async install(descriptor, {signal,onProgress=()=>{},validate=async()=>{}}={}) {
    const d=validateDescriptor(descriptor),key=d.id+':'+d.sha256;
    if(this.pending.has(key))return this.pending.get(key);
    const task=this.download(d,{signal,onProgress,validate}).finally(()=>this.pending.delete(key));
    this.pending.set(key,task);return task;
  }
  async download(d,{signal,onProgress,validate}) {
    signal?.throwIfAborted();
    const previous=this.directory(d), manifestPath=path.join(previous,'manifest.json');
    if(this.installed()[d.id]?.sha256===d.sha256 && await intact(manifestPath,d)) {
      try {
        const manifest=validateManifest(JSON.parse(await fsp.readFile(manifestPath,'utf8')));
        let valid=true;for(const f of manifest.files){signal?.throwIfAborted();if(!await intact(path.join(previous,f.path),f)){valid=false;break;}}
        if(valid){await validate(previous,manifest);onProgress({receivedBytes:manifest.totalBytes,expectedBytes:manifest.totalBytes});return previous;}
      }catch(error){signal?.throwIfAborted();}
    }
    const bytes=await fetchBytes(new URL(`manifests/${d.sha256}.json`,this.source),d.bytes,signal);
    if(bytes.length!==d.bytes || digest(bytes)!==d.sha256)throw Error('Manifest integrity check failed');
    const m=validateManifest(JSON.parse(bytes));
    if(m.packID!==d.id || m.totalBytes!==d.totalBytes)throw Error('Manifest descriptor mismatch');
    const stage=path.join(this.root,'pending',crypto.randomUUID());await fsp.mkdir(stage,{recursive:true});
    let received=0;
    try {
      for(const f of m.files){
        signal?.throwIfAborted(); const blob=path.join(this.root,'blobs',f.sha256);
        if(!await intact(blob,f)){
          await fsp.mkdir(path.dirname(blob),{recursive:true});
          const temp=blob+'.'+crypto.randomUUID()+'.tmp';
          try {
            const seed=this.seedFile?.(f.path);
            let reused=false;
            if(seed && await intact(seed,f)){
              try{await fsp.copyFile(seed,temp,fs.constants.COPYFILE_FICLONE);reused=await intact(temp,f);}catch{}
              if(!reused)await fsp.rm(temp,{force:true});
            }
            signal?.throwIfAborted();
            if(!reused){
            const response=await fetch(new URL(`blobs/${f.sha256}`,this.source),{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(300000)]):AbortSignal.timeout(300000)});
            if(!response.ok)throw Error(`Resource request failed (${response.status})`);
            const handle=await fsp.open(temp,'wx'),hash=crypto.createHash('sha256');let count=0;
            try {for await(const chunk of response.body){count+=chunk.length;if(count>f.bytes)throw Error('Resource integrity check failed');hash.update(chunk);await handle.writeFile(chunk);onProgress({receivedBytes:received+count,expectedBytes:m.totalBytes});}}
            finally{await handle.close();}
            if(count!==f.bytes||hash.digest('hex')!==f.sha256)throw Error('Resource integrity check failed');
            }
            await fsp.rename(temp,blob);
          } finally{await fsp.rm(temp,{force:true});}
        }
        const target=path.join(stage,f.path);await fsp.mkdir(path.dirname(target),{recursive:true});
        // Independent copies prevent a consumer modifying a cached pack from poisoning shared blobs.
        await fsp.copyFile(blob,target,fs.constants.COPYFILE_FICLONE);
        received+=f.bytes;onProgress({receivedBytes:received,expectedBytes:m.totalBytes});
      }
      await fsp.writeFile(path.join(stage,'manifest.json'),bytes);signal?.throwIfAborted();await validate(stage,m);
      const generation=d.sha256+'-'+crypto.randomUUID().replaceAll('-',''),destination=path.join(this.root,'packs',d.id,generation);
      await fsp.mkdir(path.dirname(destination),{recursive:true});
      await fsp.rename(stage,destination);
      // Serialize index changes from concurrent character downloads, never drop another pack's update.
      const publish=this.commit.catch(()=>{}).then(async()=>{signal?.throwIfAborted();await atomicJSON(path.join(this.root,'installed.json'),{...this.installed(),[d.id]:{...d,generation}});});
      this.commit=publish;await publish;return destination;
    }finally{await fsp.rm(stage,{recursive:true,force:true});}
  }
}
