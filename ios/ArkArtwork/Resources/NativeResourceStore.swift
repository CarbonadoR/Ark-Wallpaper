import Foundation
import CryptoKit

struct NativeResourceStore {
 let root: URL
 static var standard: NativeResourceStore { NativeResourceStore(root:FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("Resources",isDirectory:true)) }
 func installed()->[String:String] {
  guard let data=try? Data(contentsOf:root.appendingPathComponent("installed.json")),let value=try? JSONDecoder().decode([String:String].self,from:data) else{return [:]}
  return value.filter{Self.validID($0.key)&&Self.validHash($0.value)}
 }
 static func validID(_ s:String)->Bool{s.range(of:"^[a-zA-Z0-9_-]{1,100}$",options:.regularExpression) != nil}
 static func validHash(_ s:String)->Bool{s.range(of:"^[a-f0-9]{64}$",options:.regularExpression) != nil}
 static func hash(_ url:URL)throws->String {
  let handle=try FileHandle(forReadingFrom:url);defer{try? handle.close()};var hash=SHA256()
  while let data=try handle.read(upToCount:1024*1024),!data.isEmpty{hash.update(data:data)}
  return hash.finalize().map{String(format:"%02x",$0)}.joined()
 }
 func packURL(_ id:String,_ hash:String)->URL{root.appendingPathComponent("packs/\(id)/\(hash)",isDirectory:true)}
 func activate(_ descriptor:RemotePackDescriptor)throws {
  var index=installed();index[descriptor.id]=descriptor.sha256
  try JSONEncoder().encode(index).write(to:root.appendingPathComponent("installed.json"),options:.atomic)
 }
 func prepareBundle()throws{
  try FileManager.default.createDirectory(at:root,withIntermediateDirectories:true)
  let destination=root.appendingPathComponent("bundled")
  if !FileManager.default.fileExists(atPath:destination.path),let source=Bundle.main.url(forResource:"SamplePack",withExtension:nil){try FileManager.default.copyItem(at:source,to:destination)}
 }
 func catalog(includeBundle:Bool=false)throws->ResourceCatalog {
  if includeBundle{try prepareBundle()}
  var catalogs:[ResourceCatalog]=[]
  if includeBundle,let bundled=try? ResourceCatalog.load(from:root.appendingPathComponent("bundled")){catalogs.append(bundled)}
  for (id,hash) in installed().sorted(by:{$0.key<$1.key}){if let c=try? ResourceCatalog.load(from:packURL(id,hash)){catalogs.append(c)}}
  guard !catalogs.isEmpty else{throw ResourceError.missingFile}
  var models:[Artwork]=[],backgrounds:[ArtworkBackground]=[],files:[PackFile]=[]
  for c in catalogs {
   let base=root.resolvingSymlinksInPath().path+"/"
   guard c.root.path.hasPrefix(base) else{throw ResourceError.unsafePath}
   let prefix=String(c.root.path.dropFirst(base.count))+"/"
   func p(_ s:String?)->String?{s.map{prefix+$0}}
   for m in c.models{let next=Artwork(id:m.id,name:m.name,outfit:m.outfit,kind:m.kind,mediaType:m.mediaType,image:p(m.image),atlas:p(m.atlas),skeleton:p(m.skeleton),skeletonFormat:m.skeletonFormat,pages:m.pages?.map{TexturePage(path:prefix+$0.path,alphaMode:$0.alphaMode)});if let i=models.firstIndex(where:{$0.id==m.id}){models[i]=next}else{models.append(next)}}
   for b in c.backgrounds{let next=ArtworkBackground(id:b.id,name:b.name,images:b.images.map{prefix+$0});if let i=backgrounds.firstIndex(where:{$0.id==b.id}){backgrounds[i]=next}else{backgrounds.append(next)}}
   files.append(contentsOf:c.files.map{PackFile(path:prefix+$0.path,bytes:$0.bytes,sha256:$0.sha256)})
  }
  return ResourceCatalog(schemaVersion:1,packID:"installed",version:1,models:models,backgrounds:backgrounds,files:files,root:root.resolvingSymlinksInPath())
 }
}
