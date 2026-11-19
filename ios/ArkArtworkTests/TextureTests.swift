import XCTest
import MetalKit
import ImageIO
import UniformTypeIdentifiers
import CryptoKit
@testable import ArkArtwork
final class TextureTests:XCTestCase {
 @MainActor func testBackgroundWithSameIDReloadsAfterResourceReplacement() throws {
  let root=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString);defer{try? FileManager.default.removeItem(at:root)}
  func catalog(_ name:String,_ rgba:[UInt8])throws->ResourceCatalog{
   let directory=root.appendingPathComponent(name);try FileManager.default.createDirectory(at:directory,withIntermediateDirectories:true)
   let image=CGImage(width:1,height:1,bitsPerComponent:8,bitsPerPixel:32,bytesPerRow:4,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.last.rawValue),provider:CGDataProvider(data:Data(rgba) as CFData)!,decode:nil,shouldInterpolate:false,intent:.defaultIntent)!
   let url=directory.appendingPathComponent("background.png"),output=CGImageDestinationCreateWithURL(url as CFURL,UTType.png.identifier as CFString,1,nil)!
   CGImageDestinationAddImage(output,image,nil);XCTAssertTrue(CGImageDestinationFinalize(output));let data=try Data(contentsOf:url)
   let file=PackFile(path:"background.png",bytes:data.count,sha256:SHA256.hash(data:data).map{String(format:"%02x",$0)}.joined())
   return ResourceCatalog(schemaVersion:1,packID:"test",version:1,models:[],backgrounds:[ArtworkBackground(id:"same-background",name:"Background",images:[file.path])],files:[file],root:directory)
  }
  let state=ViewerModel(),view=MTKView(frame:.zero,device:MTLCreateSystemDefaultDevice());view.colorPixelFormat = .bgra8Unorm
  let renderer=try ArtworkRenderer(view:view,state:state);var buffer:CVPixelBuffer?
  XCTAssertEqual(CVPixelBufferCreate(kCFAllocatorDefault,4,4,kCVPixelFormatType_32BGRA,[kCVPixelBufferMetalCompatibilityKey:true,kCVPixelBufferIOSurfacePropertiesKey:[:]] as CFDictionary,&buffer),kCVReturnSuccess)
  func pixel()throws->[UInt8]{try renderer.renderFrame(to:buffer!,viewport:CGSize(width:4,height:4),delta:0);CVPixelBufferLockBaseAddress(buffer!, .readOnly);defer{CVPixelBufferUnlockBaseAddress(buffer!, .readOnly)};return Array(UnsafeBufferPointer(start:CVPixelBufferGetBaseAddress(buffer!)!.assumingMemoryBound(to:UInt8.self),count:4))}
  let red=try catalog("old",[255,0,0,255]);try renderer.setBackground(catalog:red,background:red.backgrounds[0]);XCTAssertEqual(try pixel(),[0,0,255,255])
  let blue=try catalog("new",[0,0,255,255]);try renderer.setBackground(catalog:blue,background:blue.backgrounds[0]);XCTAssertEqual(try pixel(),[255,0,0,255])
 }
 func testAllPNGRowFiltersAndTruncation() throws {
  // Independently encoded 2x5 RGBA image: one row per PNG filter, same pixel values.
  let data=Data(base64Encoded:"iVBORw0KGgoAAAANSUhEUgAAAAIAAAAFCAYAAABvsz2cAAAAJElEQVR4nGPgAAIHBYEGRhDDQoKjgokBCphZgECGh8WGBSYCAEs5AoMTU2GSAAAAAElFTkSuQmCC")!
  let decoded=try PMAPNG.decode(data)
  XCTAssertEqual(decoded.width,2);XCTAssertEqual(decoded.height,5)
  XCTAssertEqual(decoded.pixels,Array(repeating:[UInt8(8),8,8,8,64,32,16,128],count:5).flatMap{$0})
  XCTAssertThrowsError(try PMAPNG.decode(Data(data.prefix(30))))
  XCTAssertThrowsError(try PMAPNG.decode(Data([1,2,3])))
 }

 @MainActor func testFaintPMAColorSurvivesTextureUpload() throws {
  let data=Data([8,8,8,8, 64,32,16,128, 255,100,50,255])
  let image=try XCTUnwrap(CGImage(width:3,height:1,bitsPerComponent:8,bitsPerPixel:32,bytesPerRow:12,space:CGColorSpaceCreateDeviceRGB(),bitmapInfo:CGBitmapInfo(rawValue:CGImageAlphaInfo.last.rawValue),provider:CGDataProvider(data:data as CFData)!,decode:nil,shouldInterpolate:false,intent:.defaultIntent))
  let url=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString+".png")
  defer {try? FileManager.default.removeItem(at:url)}
  let output=CGImageDestinationCreateWithURL(url as CFURL,UTType.png.identifier as CFString,1,nil)!
  CGImageDestinationAddImage(output,image,nil);XCTAssertTrue(CGImageDestinationFinalize(output))
  let state=ViewerModel();let view=MTKView(frame:.zero,device:MTLCreateSystemDefaultDevice());view.colorPixelFormat = .bgra8Unorm
  let renderer=try ArtworkRenderer(view:view,state:state)
  let texture=try renderer.texture(url,mode:"pma")
  var bytes=[UInt8](repeating:0,count:12)
  bytes.withUnsafeMutableBytes {texture.getBytes($0.baseAddress!,bytesPerRow:12,from:MTLRegionMake2D(0,0,3,1),mipmapLevel:0)}
  XCTAssertEqual(bytes,[8,8,8,8,64,32,16,128,255,100,50,255])
  let straight=try renderer.texture(url,mode:"straight")
  bytes.withUnsafeMutableBytes {straight.getBytes($0.baseAddress!,bytesPerRow:12,from:MTLRegionMake2D(0,0,3,1),mipmapLevel:0)}
  XCTAssertEqual(bytes,[0,0,0,8,32,16,8,128,255,100,50,255])
 }
}
