import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sourceURL} from '../server/resource-delivery.mjs';

// Build public artifacts only from the committed tree. Local plans stay outside git archive.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
if(process.platform!=='darwin')throw Error('This cross-platform release packager requires macOS, Xcode and .NET 8.');
const run=(command,args,options={})=>execFileSync(command,args,{stdio:'inherit',...options});
const read=(command,args)=>execFileSync(command,args,{encoding:'utf8'}).trim();
if(read('git',['diff','--name-only'])||read('git',['diff','--cached','--name-only']))throw Error('Commit source changes before packaging.');
const version=JSON.parse(fs.readFileSync('package.json')).version,commit=read('git',['rev-parse','HEAD']);
const source=sourceURL(JSON.parse(fs.readFileSync('config/resources.example.json')).url).href;
const targets=(process.argv.find(a=>a.startsWith('--targets='))?.slice(10)||'windows-x64,windows-arm64,macos-universal,ios-simulator-arm64').split(',');
if(targets.some(t=>!['windows-x64','windows-arm64','macos-universal','ios-simulator-arm64'].includes(t)))throw Error('Unknown release target.');
const output=path.join(root,'build/releases',`v${version}`,commit.slice(0,8));fs.mkdirSync(output,{recursive:true});
run('npm',['run','build']);
const sourceTar=path.join(output,'source.tar');run('git',['archive','--format=tar',`--output=${sourceTar}`,'HEAD']);
for(const target of targets){
 const archive=path.join(output,`Ark-Wallpaper-v${version}-${target}.zip`),stage=path.join(output,'stage-'+target);
 if(fs.existsSync(archive))throw Error(`Artifact already exists: ${path.basename(archive)}`);
 fs.rmSync(stage,{recursive:true,force:true});fs.mkdirSync(stage,{recursive:true});
 if(target.startsWith('ios-')){
  run(process.execPath,['scripts/generate-ios-project.mjs']);
  fs.writeFileSync('build/ios/ResourceServer.json',JSON.stringify({url:source})+'\n');
  const derived=path.join(output,'ios-derived');
  run('xcodebuild',['build','-project','ios/ArkArtwork.xcodeproj','-scheme','ArkArtwork','-configuration','Release','-destination','generic/platform=iOS Simulator','-derivedDataPath',derived,'ARCHS=arm64','ONLY_ACTIVE_ARCH=YES','SWIFT_OPTIMIZATION_LEVEL=-O','ENABLE_TESTABILITY=NO','DEBUG_INFORMATION_FORMAT=dwarf','MTL_ENABLE_DEBUG_INFO=NO',`OTHER_SWIFT_FLAGS=-file-prefix-map ${root}=.`,`OTHER_CPLUSPLUSFLAGS=$(inherited) -ffile-prefix-map=${root}=.`]);
  fs.cpSync(path.join(derived,'Build/Products/Release-iphonesimulator/ArkArtwork.app'),path.join(stage,'ArkArtwork.app'),{recursive:true});
  fs.copyFileSync('LICENSE',path.join(stage,'LICENSE'));
  fs.copyFileSync('build/ios/SPINE-LICENSE',path.join(stage,'SPINE-LICENSE'));
  fs.writeFileSync(path.join(stage,'README-IOS.txt'),'Ark Artwork '+version+' — iOS Simulator (Apple Silicon)\n\nRequires an iOS 27 simulator in Xcode; verified with iPhone 17 Pro / iOS 27.2.\nThis is a simulator app, not a device IPA.\n\nxcrun simctl install booted ArkArtwork.app\nxcrun simctl launch booted org.arkwallpaper.ArkArtwork\n\nIncludes a small sample pack. Use the download icon for character downloads, cached updates or full downloads.\nLive Photo export saves to Photos; system wallpaper setup must be completed in Settings on a signed physical-device build.\n');
 }else{
  run('tar',['-xf',sourceTar,'-C',stage]);fs.cpSync('dist',path.join(stage,'dist'),{recursive:true});
  fs.writeFileSync(path.join(stage,'config/resources.release.json'),JSON.stringify({url:source},null,2)+'\n');
  const native=path.join(stage,'app');fs.mkdirSync(native,{recursive:true});
  if(target.startsWith('windows-')){
   const arch=target.slice(8);
   for(const name of ['Start-Wallpaper.cmd','Start-Wallpaper.ps1','README-WINDOWS.txt'])fs.copyFileSync(path.join('windows/release',name),path.join(stage,name));
   run(process.env.ARKNIGHTS_DOTNET||'dotnet',['publish','windows/ArkWallpaper/ArkWallpaper.csproj','-c','Release','-r',`win-${arch}`,'--self-contained','true','-o',native,'-p:EnableWindowsTargeting=true','-p:DebugType=None','-p:DebugSymbols=false']);
  }else{
   for(const name of ['Start-Wallpaper.command','README-MACOS.txt'])fs.copyFileSync(path.join('macos/release',name),path.join(stage,name));
   fs.chmodSync(path.join(stage,'Start-Wallpaper.command'),0o755);
   const app=path.join(native,'Arknights Dynamic Wallpaper.app'),contents=path.join(app,'Contents'),bin=path.join(contents,'MacOS');fs.mkdirSync(bin,{recursive:true});
   const sources=fs.readdirSync('macos/Sources/ArknightsWallpaper').filter(n=>n.endsWith('.swift')).map(n=>path.join('macos/Sources/ArknightsWallpaper',n));
   const binaries=[];
   for(const arch of ['arm64','x86_64']){
    const binary=path.join(output,`ArknightsWallpaper-${arch}`);binaries.push(binary);
    run('swiftc',['-O','-file-prefix-map',`${root}=.`,'-parse-as-library','-target',`${arch}-apple-macos13.0`,'-framework','AppKit','-framework','CoreGraphics','-framework','WebKit',...sources,'-o',binary]);
   }
   run('lipo',['-create',...binaries,'-output',path.join(bin,'ArknightsWallpaper')]);
   const plist=fs.readFileSync('macos/Info.plist','utf8').replace('__PROJECT_ROOT__','').replace('__NPM_PATH__','/usr/bin/env').replace('__SERVER_URL__','http://127.0.0.1:8791');
   fs.writeFileSync(path.join(contents,'Info.plist'),plist);run('codesign',['--force','--deep','--sign','-',app]);
  }
 }
 fs.writeFileSync(path.join(stage,'release-info.json'),JSON.stringify({version,commit,target},null,2)+'\n');
 const forbidden=new Set(['AGENTS.md','.git','.superpowers','arts','charpack','skinpack','chartable','.resource-cache','node_modules','runtime.local.json','metadata.local.json','resources.local.json','scenes.local.json','launch.local.json']);
 function inspect(directory){for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
  if(forbidden.has(entry.name)||/\.(log|pdb)$/.test(entry.name))throw Error(`Forbidden release file: ${entry.name}`);
  if(entry.isSymbolicLink())throw Error('Unexpected symbolic link in release');
  if(entry.isDirectory())inspect(path.join(directory,entry.name));
 }}inspect(stage);
 run('ditto',['-c','-k','--norsrc',stage,archive]);console.log(`Packaged ${path.basename(archive)}`);
}
const archives=fs.readdirSync(output).filter(n=>n.endsWith('.zip')).sort();
const checksums=archives.map(name=>crypto.createHash('sha256').update(fs.readFileSync(path.join(output,name))).digest('hex')+'  '+name);
fs.writeFileSync(path.join(output,'SHA256SUMS.txt'),checksums.join('\n')+'\n');
console.log(`Release artifacts: ${output}`);
