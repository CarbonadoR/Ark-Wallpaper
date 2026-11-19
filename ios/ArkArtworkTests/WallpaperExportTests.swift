import XCTest
import AVFoundation
import Photos
import ImageIO
@testable import ArkArtwork

final class WallpaperExportTests: XCTestCase {
 // Catches broken pairing, absent timed metadata, or writing identical/static video frames.
 @MainActor func testLivePhotoPairAndMotion() async throws {
  let files = try await WallpaperExporter.export(size: CGSize(width:192,height:416), live:true) { time, pixel in
   CVPixelBufferLockBaseAddress(pixel, [])
   defer { CVPixelBufferUnlockBaseAddress(pixel, []) }
   let p = CVPixelBufferGetBaseAddress(pixel)!.assumingMemoryBound(to:UInt8.self)
   let row = CVPixelBufferGetBytesPerRow(pixel)
   for y in 0..<416 { for x in 0..<192 {
    let i=y*row+x*4;p[i]=UInt8(time < 1.5 ? 220 : 20);p[i+1]=40;p[i+2]=UInt8(time < 1.5 ? 20 : 220);p[i+3]=255
   }}
  }
  defer { files.remove() }
  let source=try XCTUnwrap(CGImageSourceCreateWithURL(files.photo as CFURL,nil))
  let properties=CGImageSourceCopyPropertiesAtIndex(source,0,nil)! as NSDictionary
  let maker=try XCTUnwrap(properties[kCGImagePropertyMakerAppleDictionary] as? NSDictionary)
  let identifier=try XCTUnwrap(maker["17"] as? String)
  let movie=AVURLAsset(url:try XCTUnwrap(files.video))
  let metadata=try await movie.load(.metadata)
  let content=try XCTUnwrap(metadata.first{$0.identifier == .quickTimeMetadataContentIdentifier})
  let value=try await content.load(.stringValue)
  XCTAssertEqual(identifier,value)
  let duration=try await movie.load(.duration)
  XCTAssertEqual(duration.seconds,3,accuracy:0.05)
  let tracks=try await movie.loadTracks(withMediaType:.metadata)
  XCTAssertEqual(tracks.count,1)
  let reader=try AVAssetReader(asset:movie)
  let output=AVAssetReaderTrackOutput(track:try XCTUnwrap(tracks.first),outputSettings:nil)
  let timed=AVAssetReaderOutputMetadataAdaptor(assetReaderTrackOutput:output)
  reader.add(output);XCTAssertTrue(reader.startReading())
  var stillTime:Double?
  while let group=timed.nextTimedMetadataGroup() {
   if group.items.contains(where:{$0.identifier?.rawValue == "mdta/com.apple.quicktime.still-image-time"}) {stillTime=group.timeRange.start.seconds}
  }
  XCTAssertEqual(try XCTUnwrap(stillTime),1.5,accuracy:0.01)
  let generator=AVAssetImageGenerator(asset:movie)
  let first=try await generator.image(at:CMTime(seconds:0.25,preferredTimescale:600)).image
  let last=try await generator.image(at:CMTime(seconds:2.5,preferredTimescale:600)).image
  XCTAssertNotEqual(first.dataProvider?.data as Data?,last.dataProvider?.data as Data?)
  let photo=try await files.livePhoto()
  XCTAssertGreaterThan(photo.size.height,photo.size.width)
 }
 @MainActor func testCancelledExportRemovesPartialFiles() async throws {
  let directory=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  let task=Task { try await WallpaperExporter.export(size:CGSize(width:192,height:416),live:true,directory:directory) { _,_ in throw CancellationError() } }
  do {_ = try await task.value;XCTFail("Cancellation must not publish a pair")} catch is CancellationError {} catch {XCTFail("Unexpected error: \(error)")}
  XCTAssertFalse(FileManager.default.fileExists(atPath:directory.path))
 }
 @MainActor func testStaticExportProducesOnlyPhoto() async throws {
  let files=try await WallpaperExporter.export(size:CGSize(width:192,height:416),live:false) { _,pixel in
   CVPixelBufferLockBaseAddress(pixel,[]);memset(CVPixelBufferGetBaseAddress(pixel),255,CVPixelBufferGetDataSize(pixel));CVPixelBufferUnlockBaseAddress(pixel,[])
  }
  defer {files.remove()}
  XCTAssertNil(files.video)
  XCTAssertNotNil(CGImageSourceCreateWithURL(files.photo as CFURL,nil))
 }
}
