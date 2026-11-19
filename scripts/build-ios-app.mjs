import fs from 'node:fs';import {execFileSync} from 'node:child_process';
if(!fs.existsSync('build/ios/SamplePack/manifest.json')||!fs.existsSync('build/ios/spine-cpp/include/spine/spine.h'))throw Error('Run npm run ios:prepare with a sample whitelist first');
execFileSync(process.execPath,['scripts/generate-ios-project.mjs'],{stdio:'inherit'});
execFileSync('xcodebuild',['build','-project','ios/ArkArtwork.xcodeproj','-scheme','ArkArtwork','-destination','generic/platform=iOS Simulator','-derivedDataPath','build/ios/DerivedData','ARCHS=arm64'],{stdio:'inherit'});
