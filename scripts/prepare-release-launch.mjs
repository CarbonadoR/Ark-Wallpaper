import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {sourceURL} from '../server/resource-delivery.mjs';

const root=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'..'));
const directory=path.join(root,'config');
const source=path.join(directory,'resources.release.json'),local=path.join(directory,'resources.local.json');
if(!fs.existsSync(local)&&fs.existsSync(source)){
 const url=sourceURL(JSON.parse(fs.readFileSync(source,'utf8')).url).href;
 fs.writeFileSync(local,JSON.stringify({url},null,2)+'\n',{flag:'wx'});
}
const runtime=path.join(directory,'runtime.local.json');
if(!fs.existsSync(runtime))fs.copyFileSync(path.join(directory,'runtime.example.json'),runtime,fs.constants.COPYFILE_EXCL);
const {config}=await import(pathToFileURL(path.join(root,'server/config.mjs')));
if(!['127.0.0.1','localhost','::1'].includes(config.host))throw Error('The resource service must use a loopback host');
console.log(JSON.stringify({host:config.host,port:config.port}));
