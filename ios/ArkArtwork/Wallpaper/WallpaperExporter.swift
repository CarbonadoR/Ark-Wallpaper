import AVFoundation
import CoreImage
import ImageIO
import Photos
import UniformTypeIdentifiers

struct WallpaperFiles {
 let directory: URL
 let photo: URL
 let video: URL?
 func remove() { try? FileManager.default.removeItem(at: directory) }
 func livePhoto() async throws -> PHLivePhoto {
  guard let video else { throw WallpaperError.invalidPair }
  let result: PHLivePhoto = try await withCheckedThrowingContinuation { continuation in
   PHLivePhoto.request(withResourceFileURLs: [photo, video], placeholderImage: nil, targetSize: .zero, contentMode: .aspectFit) { photo, info in
    if info[PHLivePhotoInfoIsDegradedKey] as? Bool == true { return }
    if let photo { continuation.resume(returning: photo) }
    else { continuation.resume(throwing: info[PHLivePhotoInfoErrorKey] as? Error ?? WallpaperError.invalidPair) }
   }
  }
  try Task.checkCancellation()
  return result
 }
 func saveToPhotos() async throws {
  let status = await PHPhotoLibrary.requestAuthorization(for: .addOnly)
  guard status == .authorized || status == .limited else { throw WallpaperError.photosDenied }
  try Task.checkCancellation()
  try await PHPhotoLibrary.shared().performChanges {
   let request = PHAssetCreationRequest.forAsset()
   request.addResource(with: .photo, fileURL: photo, options: nil)
   if let video { request.addResource(with: .pairedVideo, fileURL: video, options: nil) }
  }
 }
}

enum WallpaperError: LocalizedError {
 case invalidSize, encoding, invalidPair, photosDenied, interrupted
 var errorDescription: String? {
  switch self {
  case .invalidSize: return "请转为竖屏，再导出锁屏壁纸。"
  case .encoding: return "壁纸编码失败，请重试。"
  case .invalidPair: return "无法读取生成的实况照片，请重新导出。"
  case .photosDenied: return "未获得相册添加权限。请在系统设置中允许添加照片后重试。"
  case .interrupted: return "导出已中断，请保持应用在前台并重试。"
  }
 }
}

@MainActor enum WallpaperExporter {
 static func export(size: CGSize, live: Bool, directory: URL? = nil,
                    render: (Double, CVPixelBuffer) throws -> Void,
                    progress: (Double) -> Void = { _ in }) async throws -> WallpaperFiles {
  guard size.width.isFinite, size.height.isFinite, size.width >= 2, size.height >= size.width,
        size.width <= 4096, size.height <= 8192 else { throw WallpaperError.invalidSize }
  let width = Int(size.width) / 2 * 2, height = Int(size.height) / 2 * 2
  let directory = directory ?? FileManager.default.temporaryDirectory.appendingPathComponent("wallpaper-" + UUID().uuidString, isDirectory: true)
  // Never delete a caller's pre-existing directory on failure.
  guard !FileManager.default.fileExists(atPath: directory.path) else { throw WallpaperError.encoding }
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  let files = WallpaperFiles(directory: directory, photo: directory.appendingPathComponent("wallpaper.jpg"), video: live ? directory.appendingPathComponent("wallpaper.mov") : nil)
  var completed = false
  var writer: AVAssetWriter?
  defer { if !completed { writer?.cancelWriting(); files.remove() } }
  let identifier = UUID().uuidString
  let attributes: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
   kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
   kCVPixelBufferIOSurfacePropertiesKey as String: [:], kCVPixelBufferMetalCompatibilityKey as String: true]
  let context = CIContext(options: [.cacheIntermediates: false])
  func makePixel() throws -> CVPixelBuffer {
   var pixel: CVPixelBuffer?
   guard CVPixelBufferCreate(kCFAllocatorDefault,width,height,kCVPixelFormatType_32BGRA,attributes as CFDictionary,&pixel) == kCVReturnSuccess, let pixel else { throw WallpaperError.encoding }
   return pixel
  }
  func writePhoto(_ pixel: CVPixelBuffer) throws {
   let image = CIImage(cvPixelBuffer: pixel)
   guard let cg = context.createCGImage(image, from: image.extent),
         let output = CGImageDestinationCreateWithURL(files.photo as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else { throw WallpaperError.encoding }
   var properties: [CFString: Any] = [kCGImageDestinationLossyCompressionQuality: 0.96]
   if live { properties[kCGImagePropertyMakerAppleDictionary] = ["17": identifier] }
   CGImageDestinationAddImage(output,cg,properties as CFDictionary)
   guard CGImageDestinationFinalize(output) else { throw WallpaperError.encoding }
  }
  try Task.checkCancellation()
  guard let video = files.video else {
   let pixel = try makePixel(); try render(0,pixel); try writePhoto(pixel)
   completed = true; progress(1); return files
  }
  let movie = try AVAssetWriter(outputURL: video, fileType: .mov); writer = movie
  let content = AVMutableMetadataItem()
  content.identifier = .quickTimeMetadataContentIdentifier
  content.value = identifier as NSString
  content.dataType = kCMMetadataBaseDataType_UTF8 as String
  movie.metadata = [content]
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264,
   AVVideoWidthKey: width, AVVideoHeightKey: height,
   AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 12_000_000, AVVideoExpectedSourceFrameRateKey: 30, AVVideoMaxKeyFrameIntervalKey: 30]])
  input.expectsMediaDataInRealTime = false
  let pixels = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: attributes)
  var format: CMFormatDescription?
  let specification: [String: Any] = [kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier as String: "mdta/com.apple.quicktime.still-image-time",
   kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType as String: kCMMetadataBaseDataType_SInt8 as String]
  guard CMMetadataFormatDescriptionCreateWithMetadataSpecifications(allocator: kCFAllocatorDefault, metadataType: kCMMetadataFormatType_Boxed, metadataSpecifications: [specification] as CFArray, formatDescriptionOut: &format) == noErr else { throw WallpaperError.encoding }
  let metadataInput = AVAssetWriterInput(mediaType: .metadata, outputSettings: nil, sourceFormatHint: format)
  let metadata = AVAssetWriterInputMetadataAdaptor(assetWriterInput: metadataInput)
  guard movie.canAdd(input),movie.canAdd(metadataInput) else { throw WallpaperError.encoding }
  movie.add(input);movie.add(metadataInput)
  guard movie.startWriting() else { throw movie.error ?? WallpaperError.encoding }
  movie.startSession(atSourceTime: .zero)
  let still = AVMutableMetadataItem()
  still.keySpace = .quickTimeMetadata; still.key = "com.apple.quicktime.still-image-time" as NSString
  still.value = NSNumber(value: Int8(0)); still.dataType = kCMMetadataBaseDataType_SInt8 as String
  guard metadata.append(AVTimedMetadataGroup(items: [still], timeRange: CMTimeRange(start: CMTime(value:45,timescale:30),duration:CMTime(value:1,timescale:30)))) else { throw movie.error ?? WallpaperError.encoding }
  metadataInput.markAsFinished()
  for frame in 0..<90 {
   try Task.checkCancellation()
   while !input.isReadyForMoreMediaData {
    guard movie.status == .writing else { throw movie.error ?? WallpaperError.encoding }
    try await Task.sleep(for: .milliseconds(5))
   }
   try autoreleasepool {
    let pixel = try makePixel()
    try render(Double(frame)/30,pixel)
    if frame == 45 { try writePhoto(pixel) }
    guard pixels.append(pixel,withPresentationTime:CMTime(value:Int64(frame),timescale:30)) else { throw movie.error ?? WallpaperError.encoding }
   }
   progress(Double(frame+1)/90)
   await Task.yield()
  }
  input.markAsFinished();movie.endSession(atSourceTime:CMTime(value:3,timescale:1))
  await movie.finishWriting()
  try Task.checkCancellation()
  guard movie.status == .completed else { throw movie.error ?? WallpaperError.encoding }
  completed = true
  return files
 }
}
