import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {config,rootDir} from '../server/config.mjs';
import {scanResources} from '../server/catalog.mjs';
import {scanStaticArt,mergeStaticArt} from '../server/static-art.mjs';
import {scanBackgrounds} from '../server/backgrounds.mjs';
import {exportResourcePack} from './ios-resource-pack.mjs';

const args=process.argv.slice(2);
const file=args.includes('--config')?args[args.indexOf('--config')+1]:'config/ios-samples.local.json';
if(!fs.existsSync(file))throw Error('Create a local sample whitelist with modelIds and backgroundIds, then pass --config');
const sample=JSON.parse(fs.readFileSync(file));
const build=path.join(rootDir,'build/ios'),output=path.join(build,'SamplePack');
const index=mergeStaticArt(scanResources(config.resourceRoot,config.metadataFile),scanStaticArt(config));
const stage=output+'.pending-'+Date.now();
const commit='8b4844bd4b193ba9e54487ed397a777993cbad56';
const runtime=path.join(build,'spine-cpp'),revision=path.join(build,'spine-revision');
let manifest;
try {
 manifest=exportResourcePack({index,backgrounds:scanBackgrounds(config.backgroundRoot),...sample,outputDirectory:stage});
 const prepared=fs.existsSync(revision)&&fs.readFileSync(revision,'utf8').trim()===commit&&fs.existsSync(path.join(runtime,'include/spine/spine.h'))&&fs.existsSync(path.join(build,'SPINE-LICENSE'));
 if(!prepared) {
  const archive=path.join(build,'spine-source.tar.gz'),download=archive+'.download',extract=path.join(build,'spine-extract');
  const prefix='spine-runtimes-'+commit;
  try {
   execFileSync('curl',['--fail','--location','--max-time','180','--silent','--show-error',`https://codeload.github.com/EsotericSoftware/spine-runtimes/tar.gz/${commit}`,'-o',download],{stdio:'inherit'});
   fs.renameSync(download,archive);
   fs.mkdirSync(extract,{recursive:true});
   execFileSync('tar',['-xzf',archive,'-C',extract,`${prefix}/spine-cpp/spine-cpp`,`${prefix}/LICENSE`],{stdio:'inherit'});
   fs.cpSync(path.join(extract,prefix,'spine-cpp/spine-cpp'),runtime,{recursive:true});
   fs.copyFileSync(path.join(extract,prefix,'LICENSE'),path.join(build,'SPINE-LICENSE'));
   fs.writeFileSync(revision,commit+'\n');
  } finally {fs.rmSync(download,{force:true});fs.rmSync(extract,{recursive:true,force:true});}
 }
 fs.copyFileSync(path.join(build,'SPINE-LICENSE'),path.join(stage,'SPINE-LICENSE'));
 const previous=output+'.previous-'+Date.now(),existed=fs.existsSync(output);
 if(existed)fs.renameSync(output,previous);
 try {fs.renameSync(stage,output);}catch(error){if(existed)fs.renameSync(previous,output);throw error;}
} catch(error){fs.rmSync(stage,{recursive:true,force:true});throw error;}
console.log(`Prepared ${manifest.models.length} illustrations, ${manifest.backgrounds.length} backgrounds; ${(manifest.totalBytes/1048576).toFixed(1)} MiB`);
