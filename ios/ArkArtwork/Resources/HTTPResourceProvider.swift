import Foundation

struct RemotePackDescriptor: Codable, Sendable {
 let id,sha256:String
 let bytes,totalBytes:Int64
 func validate()throws{guard NativeResourceStore.validID(id),NativeResourceStore.validHash(sha256),(1...16*1024*1024).contains(bytes),(0...32*1024*1024*1024).contains(totalBytes) else{throw ResourceError.invalidManifest}}
}
struct RemoteResourcePack: Codable, Identifiable, Sendable {let id,name,type:String;let ios:RemotePackDescriptor?}
struct RemoteResourceFeed: Codable, Sendable {let schemaVersion:Int;let release:String;let packs:[RemoteResourcePack]}

actor HTTPResourceProvider: DownloadResourceProvider {
 typealias Fetcher = @Sendable (URL) async throws -> URL
 private let source:URL,store:NativeResourceStore,fetcher:Fetcher?
 private var currentFeed:RemoteResourceFeed?
 private var installing=false
 init(source:URL,root:URL,fetcher:Fetcher?=nil)throws {
  guard source.scheme=="https",source.host != nil,source.user==nil,source.password==nil,source.query==nil,source.fragment==nil else{throw ResourceError.unsafePath}
  self.source=source.absoluteString.hasSuffix("/") ? source:source.appendingPathComponent("")
  self.store=NativeResourceStore(root:root)
  self.fetcher=fetcher
 }
 private func fetch(_ url:URL,limit:Int64,progress:@escaping @Sendable (Int64)->Void={_ in})async throws->URL{
  if let fetcher{return try await fetcher(url)}
  let delegate=ResourceTransferDelegate(url:url,limit:limit,progress:progress)
  let session=URLSession(configuration:.ephemeral,delegate:delegate,delegateQueue:nil);defer{session.finishTasksAndInvalidate()}
  var request=URLRequest(url:url);request.timeoutInterval=120
  return try await withTaskCancellationHandler(operation:{
   try await withCheckedThrowingContinuation{continuation in delegate.start(session:session,request:request,continuation:continuation)}
  },onCancel:{delegate.cancel()})
 }
 func feed(refresh:Bool=false)async throws->RemoteResourceFeed {
  if !refresh,let currentFeed{return currentFeed}
  let cached=store.root.appendingPathComponent("feed.json")
  do{
   let temporary=try await fetch(source.appendingPathComponent("feed.json"),limit:16*1024*1024);defer{try? FileManager.default.removeItem(at:temporary)}
   guard try temporary.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? Int.max <= 16*1024*1024 else{throw ResourceError.invalidManifest}
   let data=try Data(contentsOf:temporary),value=try decodeFeed(data)
   try FileManager.default.createDirectory(at:store.root,withIntermediateDirectories:true);try data.write(to:cached,options:.atomic)
   currentFeed=value;return value
  }catch{
   try Task.checkCancellation()
   if !refresh,let data=try? Data(contentsOf:cached),let value=try? decodeFeed(data){currentFeed=value;return value}
   throw error
  }
 }
 private func decodeFeed(_ data:Data)throws->RemoteResourceFeed {
  let value=try JSONDecoder().decode(RemoteResourceFeed.self,from:data)
  guard value.schemaVersion==1,value.packs.count<=10000,Set(value.packs.map(\.id)).count==value.packs.count else{throw ResourceError.invalidManifest}
  for pack in value.packs{guard NativeResourceStore.validID(pack.id) else{throw ResourceError.invalidManifest};try pack.ios?.validate()}
  return value
 }
 func catalog()async throws->ResourceCatalog{try store.catalog()}
 func install(packID:String,progress:@escaping @Sendable (DownloadProgress)->Void)async throws->URL {
  try Task.checkCancellation()
  guard !installing else{throw ResourceError.downloadBusy};installing=true;defer{installing=false}
  guard let descriptor=try await feed().packs.compactMap(\.ios).first(where:{$0.id==packID}) else{throw ResourceError.invalidManifest}
  let fm=FileManager.default,destination=store.packURL(descriptor.id,descriptor.sha256)
  if store.installed()[descriptor.id]==descriptor.sha256,let existing=try? ResourceCatalog.load(from:destination),(try? existing.validate(existing.files.map(\.path))) != nil{return destination}
  let downloaded=try await fetch(source.appendingPathComponent("manifests/\(descriptor.sha256).json"),limit:descriptor.bytes);defer{try? fm.removeItem(at:downloaded)}
  guard try downloaded.resourceValues(forKeys:[.fileSizeKey]).fileSize==Int(descriptor.bytes),try NativeResourceStore.hash(downloaded)==descriptor.sha256 else{throw ResourceError.invalidManifest}
  let stage=store.root.appendingPathComponent("pending/"+UUID().uuidString,isDirectory:true)
  try fm.createDirectory(at:stage,withIntermediateDirectories:true);defer{try? fm.removeItem(at:stage)}
  try fm.copyItem(at:downloaded,to:stage.appendingPathComponent("manifest.json"))
  let manifest=try ResourceCatalog.load(from:stage)
  guard manifest.packID==descriptor.id,manifest.files.count<=100000,manifest.files.allSatisfy({$0.bytes<=512*1024*1024}),manifest.files.reduce(Int64(0),{$0+Int64($1.bytes)})==descriptor.totalBytes else{throw ResourceError.invalidManifest}
  var received:Int64=0
  for file in manifest.files {
   try Task.checkCancellation()
   let blob=store.root.appendingPathComponent("blobs/"+file.sha256)
   let valid=(try? blob.resourceValues(forKeys:[.fileSizeKey]).fileSize)==file.bytes && (try? NativeResourceStore.hash(blob))==file.sha256
   if !valid {
    let base=received
    let temporary=try await fetch(source.appendingPathComponent("blobs/"+file.sha256),limit:Int64(file.bytes)){written in progress(DownloadProgress(receivedBytes:base+written,expectedBytes:descriptor.totalBytes))};defer{try? fm.removeItem(at:temporary)}
    guard try temporary.resourceValues(forKeys:[.fileSizeKey]).fileSize==file.bytes,try NativeResourceStore.hash(temporary)==file.sha256 else{throw ResourceError.invalidManifest}
    try fm.createDirectory(at:blob.deletingLastPathComponent(),withIntermediateDirectories:true)
    if fm.fileExists(atPath:blob.path){try fm.removeItem(at:blob)}
    try fm.moveItem(at:temporary,to:blob)
   }
   let target=stage.appendingPathComponent(file.path)
   try fm.createDirectory(at:target.deletingLastPathComponent(),withIntermediateDirectories:true);try fm.copyItem(at:blob,to:target)
   received+=Int64(file.bytes);progress(DownloadProgress(receivedBytes:received,expectedBytes:descriptor.totalBytes))
  }
  try Task.checkCancellation()
  try fm.createDirectory(at:destination.deletingLastPathComponent(),withIntermediateDirectories:true)
  if fm.fileExists(atPath:destination.path){try fm.removeItem(at:destination)}
  try fm.moveItem(at:stage,to:destination);try store.activate(descriptor);return destination
 }
}
final class ResourceTransferDelegate:NSObject,URLSessionDownloadDelegate,@unchecked Sendable {
 let url:URL,limit:Int64,progress:@Sendable(Int64)->Void
 private let lock=NSLock()
 private var continuation:CheckedContinuation<URL,Error>?
 private var task:URLSessionDownloadTask?
 private var cancelled=false
 init(url:URL,limit:Int64,progress:@escaping @Sendable(Int64)->Void){self.url=url;self.limit=limit;self.progress=progress}
 func start(session:URLSession,request:URLRequest,continuation:CheckedContinuation<URL,Error>){
  lock.lock();self.continuation=continuation;let task=session.downloadTask(with:request);self.task=task;let cancelled=self.cancelled;lock.unlock()
  if cancelled{task.cancel();complete(.failure(CancellationError()))}else{task.resume()}
 }
 func cancel(){lock.lock();cancelled=true;let current=task;lock.unlock();current?.cancel();complete(.failure(CancellationError()))}
 private func complete(_ result:Result<URL,Error>){
  lock.lock();let continuation=self.continuation;self.continuation=nil;lock.unlock()
  if let continuation{continuation.resume(with:result)}else if case .success(let file)=result{try? FileManager.default.removeItem(at:file)}
 }
 func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping(URLRequest?)->Void){completionHandler(nil)}
 func urlSession(_ session:URLSession,downloadTask:URLSessionDownloadTask,didFinishDownloadingTo location:URL){
  do{
   guard let response=downloadTask.response as? HTTPURLResponse,response.statusCode==200,response.url==url else{throw URLError(.badServerResponse)}
   guard Int64(try location.resourceValues(forKeys:[.fileSizeKey]).fileSize ?? Int.max)<=limit else{throw ResourceError.invalidManifest}
   let saved=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
   try FileManager.default.moveItem(at:location,to:saved);complete(.success(saved))
  }catch{complete(.failure(error))}
 }
 func urlSession(_ session:URLSession,task:URLSessionTask,didCompleteWithError error:Error?){if let error{complete(.failure(error))}}
 func urlSession(_ session:URLSession,downloadTask:URLSessionDownloadTask,didWriteData bytesWritten:Int64,totalBytesWritten:Int64,totalBytesExpectedToWrite:Int64){
  if totalBytesWritten>limit||totalBytesExpectedToWrite>limit{complete(.failure(ResourceError.invalidManifest));downloadTask.cancel()}else{progress(totalBytesWritten)}
 }
}
