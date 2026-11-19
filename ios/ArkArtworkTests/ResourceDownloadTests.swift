import XCTest
import CryptoKit
@testable import ArkArtwork

final class ResourceDownloadTests: XCTestCase {
 func testPublicTransferStreamsProgressAndRejectsOversize() async throws {
  guard let config=Bundle.main.url(forResource:"ResourceServer",withExtension:"json"),let settings=try? JSONDecoder().decode([String:String].self,from:Data(contentsOf:config)),let value=settings["url"],let base=URL(string:value),base.scheme=="https",!value.contains("example.invalid") else{throw XCTSkip("Configure a local HTTPS resource service to run the public transfer check.")}
  let sample=try ResourceCatalog.load(from:Bundle.main.url(forResource:"SamplePack",withExtension:nil)!),file=try XCTUnwrap(sample.files.first{$0.bytes>1024*1024})
  let url=base.appendingPathComponent("blobs/"+file.sha256),observations=TransferObservations()
  func transfer(limit:Int64)async throws->URL{
   let delegate=ResourceTransferDelegate(url:url,limit:limit){observations.record($0)}
   let session=URLSession(configuration:.ephemeral,delegate:delegate,delegateQueue:nil);defer{session.invalidateAndCancel()}
   return try await withCheckedThrowingContinuation{delegate.start(session:session,request:URLRequest(url:url),continuation:$0)}
  }
  let temporary=try await transfer(limit:Int64(file.bytes));defer{try? FileManager.default.removeItem(at:temporary)}
  XCTAssertGreaterThan(observations.count,0);XCTAssertEqual(try NativeResourceStore.hash(temporary),file.sha256)
  do{let unexpected=try await transfer(limit:128*1024);try? FileManager.default.removeItem(at:unexpected);XCTFail("Size bound must reject the transfer")}catch{XCTAssertTrue(error is ResourceError)}
 }
 func testCharacterDownloadAndOfflineCatalog() async throws {
  let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer{try? FileManager.default.removeItem(at:root)}
  let fixture=try DownloadFixture(),provider=try HTTPResourceProvider(source:URL(string:"https://example.invalid/")!,root:root,fetcher:fixture.fetch)
  let feed=try await provider.feed();XCTAssertEqual(feed.packs.count,1)
  _ = try await provider.install(packID:"character-test"){_ in}
  let catalog=try await provider.catalog();XCTAssertEqual(catalog.models.count,1)
  XCTAssertEqual(try Data(contentsOf:catalog.resolve(catalog.models[0].image!)),Data("pixels".utf8))
  fixture.offline=true
  _ = try await provider.install(packID:"character-test"){_ in}
  let offline=try NativeResourceStore(root:root).catalog()
  XCTAssertEqual(offline.models.count,1)
 }
 func testCorruptDownloadDoesNotBecomeInstalled() async throws {
  let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  defer{try? FileManager.default.removeItem(at:root)}
  let fixture=try DownloadFixture();fixture.corrupt=true
  let provider=try HTTPResourceProvider(source:URL(string:"https://example.invalid/")!,root:root,fetcher:fixture.fetch)
  do{_ = try await provider.install(packID:"character-test"){_ in};XCTFail("Corrupt bytes must fail")}catch{}
  XCTAssertTrue(NativeResourceStore(root:root).installed().isEmpty)
 }
 func testRemoteURLMustBeHTTPS() {
  XCTAssertThrowsError(try HTTPResourceProvider(source:URL(string:"http://example.invalid/")!,root:FileManager.default.temporaryDirectory))
  XCTAssertThrowsError(try HTTPResourceProvider(source:URL(string:"https://user:secret@example.invalid/")!,root:FileManager.default.temporaryDirectory))
 }
}
private final class TransferObservations:@unchecked Sendable {
 private let lock=NSLock();private var values:[Int64]=[]
 func record(_ bytes:Int64){lock.lock();values.append(bytes);lock.unlock()}
 var count:Int{lock.lock();defer{lock.unlock()};return values.count}
}
private final class DownloadFixture: @unchecked Sendable {
 var offline=false,corrupt=false
 let contents:[String:Data]
 init()throws{
  func hash(_ d:Data)->String{SHA256.hash(data:d).map{String(format:"%02x",$0)}.joined()}
  let pixels=Data("pixels".utf8),image="models/0123456789abcdef/image.png"
  let manifest=try JSONSerialization.data(withJSONObject:["schemaVersion":1,"packID":"character-test","version":1,"models":[["id":"0123456789abcdef","name":"Test","outfit":"Test","kind":"StaticSkin","mediaType":"image","image":image]],"backgrounds":[],"files":[["path":image,"bytes":pixels.count,"sha256":hash(pixels)]],"totalBytes":pixels.count])
  let descriptor:[String:Any]=["id":"character-test","sha256":hash(manifest),"bytes":manifest.count,"totalBytes":pixels.count]
  let feed=try JSONSerialization.data(withJSONObject:["schemaVersion":1,"release":"test","packs":[["id":"test","name":"Test","type":"character","ios":descriptor]]])
  contents=["/feed.json":feed,"/manifests/\(hash(manifest)).json":manifest,"/blobs/\(hash(pixels))":pixels]
 }
 func fetch(_ url:URL)async throws->URL{
  if offline{throw URLError(.notConnectedToInternet)}
  guard let data=contents[url.path] else{throw URLError(.fileDoesNotExist)}
  let file=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try (corrupt&&url.path.hasPrefix("/blobs/") ? Data("broken".utf8):data).write(to:file)
  return file
 }
}
