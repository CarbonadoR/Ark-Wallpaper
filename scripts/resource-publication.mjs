import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {digest,fileHash,safePath,validateManifest,atomicJSON} from '../server/resource-delivery.mjs';

export class Publication {
  constructor(root){this.root=path.resolve(root);this.known=new Set();}
  async add(relative,source){
    safePath(relative);
    if(/(?:^|\/)(?:config|\.git)(?:\/|$)|\.local\.(?:json|md)$|(?:^|\/)AGENTS\.md$/i.test(relative))throw Error('Local configuration cannot be published');
    const buffer=Buffer.isBuffer(source),bytes=buffer?source.length:(await fsp.stat(source)).size,sha256=buffer?digest(source):await fileHash(source);
    const target=path.join(this.root,'blobs',sha256);
    if(!this.known.has(sha256)){
      await fsp.mkdir(path.dirname(target),{recursive:true});
      if(!fs.existsSync(target)){
        const temporary=target+'.tmp';
        if(buffer)await fsp.writeFile(temporary,source);else await fsp.copyFile(source,temporary,fs.constants.COPYFILE_FICLONE);
        if(await fileHash(temporary)!==sha256)throw Error('Source changed while publishing');
        await fsp.rename(temporary,target);
      }
      this.known.add(sha256);
    }
    return {path:relative,bytes,sha256};
  }
  async pack(manifest){
    validateManifest(manifest);const bytes=Buffer.from(JSON.stringify(manifest)),sha256=digest(bytes);
    await fsp.mkdir(path.join(this.root,'manifests'),{recursive:true});
    await fsp.writeFile(path.join(this.root,'manifests',sha256+'.json'),bytes);
    return {id:manifest.packID,sha256,bytes:bytes.length,totalBytes:manifest.totalBytes};
  }
  async finish(feed){
    const totals={};
    for(const platform of ['desktop','ios']){
      const files=new Map();
      for(const pack of feed.packs||[])if(pack[platform]){const manifest=JSON.parse(await fsp.readFile(path.join(this.root,'manifests',pack[platform].sha256+'.json'),'utf8'));for(const file of manifest.files)files.set(file.sha256,file.bytes);}
      totals[platform+'Bytes']=[...files.values()].reduce((n,bytes)=>n+bytes,0);
    }
    await atomicJSON(path.join(this.root,'feed.json'),{...feed,totals});
  }
}
