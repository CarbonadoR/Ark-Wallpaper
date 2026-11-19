import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import {ResourceLibrary} from './resource-library.mjs';
import {atomicJSON,sourceURL} from './resource-delivery.mjs';

export function resourceRoutes({root,localConfig={}}){
  const settingsFile=path.join(root,'config/resources.local.json'),cacheRoot=path.join(root,'.resource-cache');
  const roots=[['arts/dynchars/',localConfig.resourceRoot],['arts/ui/homebackground/wrapper/',localConfig.backgroundRoot],['arts/ui/',localConfig.uiRoot],['charpack/',localConfig.charpackRoot],['skinpack/',localConfig.skinpackRoot]];
  const seedFile=relative=>{const entry=roots.find(([prefix,directory])=>directory&&relative.startsWith(prefix));return entry?path.join(entry[1],relative.slice(entry[0].length)):null;};
  let library=null;
  const create=source=>source?new ResourceLibrary({root:cacheRoot,source,seedFile}):null;
  const configure=source=>{library=create(source);};
  try{configure(process.env.ARKNIGHTS_RESOURCE_SERVER||JSON.parse(fs.readFileSync(settingsFile,'utf8')).url);}catch{}
  const refreshing=library?library.refresh().catch(()=>{}):Promise.resolve();
  const ready=library?.feed?Promise.resolve():refreshing;
  const router=express.Router();
  router.get('/resources/status',(_req,res)=>res.json(library?.status()||{source:'',busy:false,packs:0,cachedPacks:0,totalBytes:0}));
  router.use('/resources',(req,res,next)=>{
    if(req.method==='GET')return next();
    const origin=`${req.protocol}://${req.get('host')}`;
    if(!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname)||(req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return res.sendStatus(403);
    if(!req.is('application/json'))return res.sendStatus(415);next();
  },express.json({limit:'4kb'}));
  router.put('/resources/settings',async(req,res)=>{
    if(library?.operation)return res.status(409).json({error:'请先结束当前下载。'});
    try{const source=req.body.url?sourceURL(req.body.url).href:'',candidate=create(source);if(candidate)await candidate.refresh({strict:true});await atomicJSON(settingsFile,{url:source});library=candidate;res.json(library?.status()||{source:''});}
    catch{res.status(400).json({error:'资源地址无法读取，请使用有效的 HTTPS 资源服务地址。'});}
  });
  router.post('/resources/check',async(_req,res)=>{try{if(!library)throw Error();await library.refresh();res.json(library.status());}catch{res.status(502).json({error:'无法检查资源更新，请配置下载地址并检查连接。'});}});
  router.post('/resources/download',(req,res)=>{try{if(!library||!['all','cached'].includes(req.body.mode))throw Error('无效下载请求');library.start(req.body.mode);res.status(202).json(library.status());}catch(e){res.status(409).json({error:e.message});}});
  router.post('/resources/cancel',(_req,res)=>{library?.cancel();res.json({cancelled:true});});
  return {router,ready,get library(){return library;}};
}
